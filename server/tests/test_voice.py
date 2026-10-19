import asyncio
import json
import stat
import io
import wave

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.db import Base
from app.llm import ModelUnavailable, stream_model
from app.main import create_app
from app.seed import seed_demo
from app.speech import SpeechUnavailable, synthesize
from app.speech import stream_pcm
from app.text_stream import ReasoningFilter, SentenceBuffer
from app.voice_stream import stream_voice
from app.recognition import playback_command
from test_backend import admin_headers, configuration, parse_sse, session


def test_reasoning_tags_split_at_every_position_are_never_public():
    text = '<think priority="high">隐藏的思考<analysis>内部步骤</analysis></think>剪纸使用剪刀。'
    for split in range(len(text) + 1):
        parser = ReasoningFilter()
        output = parser.feed(text[:split]) + parser.feed(text[split:]) + parser.feed('', final=True)
        assert output == '剪纸使用剪刀。'
    parser = ReasoningFilter()
    assert parser.feed('回答。<think>未关闭的内部思考', final=True) == '回答。'


def test_dify_discards_thought_events_and_preserves_local_context(tmp_path):
    requests = []
    def handler(request):
        requests.append(request)
        frames = [
            {'event': 'agent_thought', 'thought': '内部操作信息不要朗读'},
            {'event': 'agent_message', 'answer': '<thi'},
            {'event': 'agent_message', 'answer': 'nk>内部思考</think>最终讲解。'},
            {'event': 'message_end', 'metadata': {'usage': {'prompt_tokens': 20, 'completion_tokens': 10}}},
        ]
        return httpx.Response(200, text=''.join('data: '+json.dumps(frame, ensure_ascii=False)+'\n\n' for frame in frames))
    settings = configuration(tmp_path, llm_mode='live', llm_provider='dify', llm_api_key='dummy-dify',
                             llm_api_base_url='https://api.dify.ai/v1')
    async def scenario():
        chunks = [chunk async for chunk in stream_model(settings, [{'role':'user','content':'当前物品：剪纸'}],
                    httpx.MockTransport(handler), user='visitor-one')]
        assert ''.join(chunk.text for chunk in chunks) == '最终讲解。'
        assert chunks[-1].usage == {'prompt_tokens': 20, 'completion_tokens': 10}
    asyncio.run(scenario())
    body = json.loads(requests[0].content)
    assert str(requests[0].url).endswith('/v1/chat-messages')
    assert body['response_mode'] == 'streaming' and body['user'] == 'heritage-visitor-one'
    assert '剪纸' in body['query'] and body['conversation_id'] == ''


@pytest.mark.parametrize('frames', [
    [{'event':'agent_message','answer':'未结束'}],
    [{'event':'error','message':'provider secret must not leak'}],
    [{'event':'message_end'}],
])
def test_dify_incomplete_or_failed_stream_is_not_a_success(tmp_path, frames):
    settings = configuration(tmp_path, llm_mode='live', llm_provider='dify', llm_api_key='dummy-key',
                             llm_api_base_url='https://api.dify.ai/v1')
    async def scenario():
        transport = httpx.MockTransport(lambda request: httpx.Response(200, text=''.join(
            'data: '+json.dumps(frame)+'\n\n' for frame in frames)))
        with pytest.raises(ModelUnavailable) as error:
            async for _ in stream_model(settings, [{'role':'user','content':'提问'}], transport):
                pass
        assert 'secret' not in str(error.value)
    asyncio.run(scenario())


def test_speech_ready_before_model_finishes_and_sentence_order(tmp_path):
    async def scenario():
        continue_model = asyncio.Event()
        text_complete = False
        bodies = []
        async def source():
            nonlocal text_complete
            yield {'event':'start','data':{}}
            yield {'event':'delta','data':{'text':'第一句。'}}
            await continue_model.wait()
            yield {'event':'delta','data':{'text':'第二句。'}}
            text_complete = True
            yield {'event':'result','data':{'text':'第一句。第二句。'}}
        def handler(request):
            bodies.append(json.loads(request.content))
            return httpx.Response(200, content=b'ID3-test-mp3-bytes')
        settings = configuration(tmp_path, speech_enabled=True, speech_api_key='dummy-speech')
        events = []
        async with asyncio.timeout(3):
            async for event in stream_voice(source(), settings, httpx.MockTransport(handler)):
                events.append(event)
                if event['event']=='audio' and event['data']['sequence']==1:
                    assert not text_complete
                    continue_model.set()
        audio = [event['data'] for event in events if event['event']=='audio']
        assert [part['text'] for part in audio] == ['第一句。','第二句。']
        assert [part['sequence'] for part in audio] == [1,2]
        assert all(body['stream'] is True for body in bodies)
        metrics = events[-1]['data']
        assert events[-1]['event']=='voice_done' and metrics['segments']==2
        assert metrics['first_audio_ready_ms'] <= metrics['text_done_ms']
    asyncio.run(scenario())


def test_speech_failure_keeps_text_and_sanitizes_error(tmp_path):
    async def scenario():
        async def source():
            yield {'event':'delta','data':{'text':'正常文字。'}}
            yield {'event':'result','data':{'text':'正常文字。'}}
        settings = configuration(tmp_path, speech_enabled=True, speech_api_key='dummy-speech')
        transport = httpx.MockTransport(lambda request: httpx.Response(403,
            json={'message':'Access denied: please complete identity verification. private-key'}))
        events = [event async for event in stream_voice(source(), settings, transport)]
        assert any(event['event']=='result' for event in events)
        error = next(event for event in events if event['event']=='speech_error')
        assert error['data']['code']=='speech_identity_required'
        assert 'private-key' not in json.dumps(events)
        assert not any(event['event']=='audio' for event in events)
    asyncio.run(scenario())


def test_stream_cancel_closes_active_speech_and_source(tmp_path):
    async def scenario():
        waiting = asyncio.Event()
        cancelled = asyncio.Event()
        source_closed = asyncio.Event()
        class BlockingAudio(httpx.AsyncByteStream):
            async def __aiter__(self):
                waiting.set()
                try:
                    await asyncio.Event().wait()
                    yield b'ID3'
                finally:
                    cancelled.set()
        async def source():
            try:
                yield {'event':'delta','data':{'text':'一段声音。'}}
                await waiting.wait()
                yield {'event':'delta','data':{'text':'后续文字。'}}
                await asyncio.Event().wait()
            finally:
                source_closed.set()
        settings = configuration(tmp_path, speech_enabled=True, speech_api_key='dummy-key')
        stream = stream_voice(source(), settings, httpx.MockTransport(
            lambda request: httpx.Response(200, stream=BlockingAudio())))
        async with asyncio.timeout(3):
            async for event in stream:
                if waiting.is_set():
                    break
            await stream.aclose()
            await cancelled.wait()
            await source_closed.wait()
    asyncio.run(scenario())


def test_sentence_buffer_flushes_short_and_long_text_without_loss():
    parser = SentenceBuffer(max_length=30)
    text = '这是第一句。' + '长句内容' * 20 + '，这是最后一句'
    pieces = []
    for char in text:
        pieces.extend(parser.feed(char))
    pieces.extend(parser.feed('', final=True))
    assert ''.join(pieces) == text
    assert all(len(piece) <= 30 for piece in pieces)


def test_config_and_voice_endpoint_auth_and_no_key_readback(tmp_path):
    app = create_app(configuration(tmp_path), configuration_path=tmp_path/'.env',
                     speech_transport=httpx.MockTransport(lambda request: httpx.Response(200, content=b'ID3-test')))
    Base.metadata.create_all(app.state.engine)
    with app.state.db_factory() as db:
        seed_demo(db)
    with TestClient(app) as client:
        assert client.put('/api/v1/admin/speech',json={'api_key':'private-speech'}).status_code==401
        auth = admin_headers(client)
        response = client.put('/api/v1/admin/speech', headers=auth, json={
            'enabled':True,'api_key':'private-speech','voice':'bella'})
        assert response.status_code==200 and 'private-speech' not in response.text
        assert stat.S_IMODE((tmp_path/'.env').stat().st_mode)==0o600
        reloaded = Settings(_env_file=tmp_path/'.env', **{
            'database_url':app.state.settings.database_url,'admin_password':'test-only-password-123',
            'secret_key':'test-secret-'*5})
        assert reloaded.speech_enabled and reloaded.speech_voice=='bella'
        probe = client.post('/api/v1/admin/speech/test', headers=auth, json={})
        assert probe.status_code==200 and probe.json()['data']['mime_type']=='audio/mpeg'
        sid, visitor = session(client,item_id='paper-cutting')
        path='/api/v1/sessions/'+sid+'/interact/voice-stream'
        assert client.post(path, json={'event':'explain'}).status_code==404
        response = client.post(path,headers=visitor,json={'event':'explain'})
        events = parse_sse(response.text)
        assert response.status_code==200
        assert any(name=='audio' for name,data in events)
        assert any(name=='result' for name,data in events)
        assert events[-1][0]=='voice_done'
        assert client.put('/api/v1/admin/speech',headers=auth,json={
            'api_key':'bad\nkey'}).status_code==422
        assert 'private-speech' not in client.get('/api/v1/voice/status').text


def test_html_error_with_status_200_is_not_audio(tmp_path):
    async def scenario():
        settings=configuration(tmp_path,speech_enabled=True,speech_api_key='dummy-key')
        with pytest.raises(SpeechUnavailable) as error:
            await synthesize(settings,'测试',httpx.MockTransport(lambda request:
                httpx.Response(200,content=b'<html>gateway unavailable</html>')))
        assert error.value.code=='speech_invalid_audio'
    asyncio.run(scenario())


def test_dify_returns_document_sources_without_content_or_tool_details(tmp_path):
    frames = [
        {'event': 'agent_message', 'answer': '根据藏品资料进行讲解。'},
        {'event': 'message_end', 'metadata': {'retriever_resources': [
            {'document_id': 'doc-one', 'document_name': '收藏品介绍.docx', 'dataset_name': '非遗知识库',
             'content': 'private full document', 'segment_id': 'part-one'},
            {'document_id': 'doc-one', 'document_name': '收藏品介绍.docx', 'dataset_name': '非遗知识库'},
            {'document_name': 'invalid'},
        ]}},
    ]
    settings = configuration(tmp_path, llm_mode='live', llm_provider='dify',
                             llm_api_key='test-key', llm_api_base_url='https://api.dify.ai/v1')
    async def scenario():
        chunks = [chunk async for chunk in stream_model(settings, [{'role':'user','content':'介绍藏品'}],
                    httpx.MockTransport(lambda request: httpx.Response(200, text=''.join(
                        'data: '+json.dumps(frame)+'\n\n' for frame in frames))))]
        assert chunks[-1].sources == [{'id':'dify:doc-one','title':'收藏品介绍.docx',
            'source_name':'非遗知识库','source_url':None,'is_demo':False}]
        assert 'private full document' not in str(chunks[-1].sources)
    asyncio.run(scenario())


def recording_bytes(seconds=1):
    output = io.BytesIO()
    with wave.open(output, 'wb') as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(16000)
        audio.writeframes(b'\0\0' * int(seconds * 16000))
    return output.getvalue()


def test_transcription_auth_format_and_playback_command(tmp_path):
    requests = []
    def handler(request):
        requests.append(request)
        return httpx.Response(200, json={'text':'暂停讲解。'})
    settings = configuration(tmp_path, llm_mode='live', llm_provider='dify',
                             llm_api_key='dummy-key', llm_api_base_url='https://api.dify.ai/v1')
    app = create_app(settings, recognition_transport=httpx.MockTransport(handler))
    Base.metadata.create_all(app.state.engine)
    with app.state.db_factory() as db:
        seed_demo(db)
    with TestClient(app) as client:
        sid, visitor = session(client, item_id='paper-cutting')
        path = '/api/v1/sessions/'+sid+'/transcribe'
        headers = {**visitor, 'Content-Type':'audio/wav'}
        assert client.post(path, content=recording_bytes()).status_code == 404
        assert client.post(path, headers=visitor, content=recording_bytes()).status_code == 415
        assert client.post(path, headers=headers, content=b'not wav').status_code == 422
        assert client.post(path, headers=headers, content=recording_bytes(.1)).status_code == 422
        assert not requests
        response = client.post(path, headers=headers, content=recording_bytes())
        assert response.status_code == 200
        assert response.json()['data']['command'] == 'audio_pause'
        assert b'heritage-'+sid.encode() in requests[0].content
        assert b'filename="recording.wav"' in requests[0].content
        assert b'Content-Type: audio/wav' in requests[0].content
        assert client.get('/api/v1/sessions/'+sid, headers=visitor).json()['data']['turn_count'] == 0
    assert playback_command('请讲解暂停烧制有什么作用') is None
    assert playback_command('再讲一遍。') == 'audio_repeat'


def test_dify_sources_reach_backend_reply(tmp_path):
    frames = [
        {'event':'agent_message','answer':'资料中的回答。'},
        {'event':'message_end','metadata':{'retriever_resources':[
            {'document_id':'source-doc','document_name':'收藏品介绍.docx','dataset_name':'非遗知识库'}]}},
    ]
    settings = configuration(tmp_path, llm_mode='live', llm_provider='dify',
                             llm_api_key='dummy-key', llm_api_base_url='https://api.dify.ai/v1')
    app = create_app(settings, model_transport=httpx.MockTransport(lambda request: httpx.Response(200,
        text=''.join('data: '+json.dumps(frame)+'\n\n' for frame in frames))))
    Base.metadata.create_all(app.state.engine)
    with app.state.db_factory() as db:
        seed_demo(db)
    with TestClient(app) as client:
        sid, visitor = session(client, item_id='paper-cutting')
        result = client.post('/api/v1/sessions/'+sid+'/interact', headers=visitor,
                             json={'event':'ask','question':'讲讲这件作品'}).json()['data']
        assert any(source['id']=='dify:source-doc' for source in result['sources'])
        assert result['mode']=='live' and result['session']['turn_count']==1


def test_failed_transcription_does_not_expose_provider_secrets(tmp_path):
    settings = configuration(tmp_path, llm_mode='live', llm_provider='dify',
                             llm_api_key='dummy-key', llm_api_base_url='https://api.dify.ai/v1')
    app = create_app(settings, recognition_transport=httpx.MockTransport(lambda request:
        httpx.Response(403, json={'message':'provider-private-key'})))
    Base.metadata.create_all(app.state.engine)
    with TestClient(app) as client:
        sid, visitor = session(client)
        response = client.post('/api/v1/sessions/'+sid+'/transcribe', headers={**visitor,'Content-Type':'audio/wav'},
                               content=recording_bytes())
        assert response.status_code==503 and 'provider-private-key' not in response.text


def test_pcm_reaches_visitor_before_the_sentence_finishes(tmp_path):
    async def scenario():
        release_audio = asyncio.Event()
        source_closed = asyncio.Event()
        speech_finished = False
        class Audio(httpx.AsyncByteStream):
            async def __aiter__(self):
                nonlocal speech_finished
                try:
                    yield b'\x01\x00' * 2400
                    await release_audio.wait()
                    yield b'\x02\x00' * 2400
                    speech_finished = True
                finally:
                    source_closed.set()
        def handler(request):
            body = json.loads(request.content)
            assert body['response_format']=='pcm' and body['sample_rate']==24000 and body['stream']
            return httpx.Response(200, stream=Audio())
        async def source():
            yield {'event':'delta','data':{'text':'第一段讲解。'}}
            yield {'event':'result','data':{'text':'第一段讲解。'}}
        settings = configuration(tmp_path, speech_enabled=True, speech_api_key='test-key')
        events = []
        async with asyncio.timeout(3):
            async for event in stream_voice(source(),settings,httpx.MockTransport(handler),audio_format='pcm'):
                events.append(event)
                if event['event']=='audio_chunk':
                    assert not speech_finished or release_audio.is_set()
                    release_audio.set()
        assert source_closed.is_set()
        assert [event['event'] for event in events].count('audio_chunk')==2
        assert events[-1]['data']['audio_format']=='pcm'
        assert events[-1]['data']['segments']==1
        assert events[-1]['data']['first_audio_ready_ms'] is not None
    asyncio.run(scenario())


def test_first_phrase_is_not_held_until_a_long_sentences_period():
    parser = SentenceBuffer(first_length=28)
    first = parser.feed('这只碗的碗心画着石榴纹，')
    assert first == ['这只碗的碗心画着石榴纹，']
    rest = '接下来的解释还有很多内容，' * 8 + '最后结束。'
    pieces = parser.feed(rest) + parser.feed('',final=True)
    assert ''.join(first+pieces) == '这只碗的碗心画着石榴纹，'+rest
    assert len(pieces[0])>28


def test_pcm_samples_survive_odd_network_chunk_boundaries(tmp_path):
    async def scenario():
        class Audio(httpx.AsyncByteStream):
            async def __aiter__(self):
                for chunk in (b'\x01', b'\x00\x02', b'\x00'):
                    yield chunk
        settings = configuration(tmp_path, speech_enabled=True, speech_api_key='test-key')
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request:
                httpx.Response(200,stream=Audio()))) as client:
            parts=[part async for part in stream_pcm(settings,'讲解',client)]
        assert b''.join(parts)==b'\x01\x00\x02\x00'
        assert all(len(part)%2==0 for part in parts)
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request:
                httpx.Response(200,headers={'Content-Type':'application/json'},json={'error':'private-key'}))) as client:
            with pytest.raises(SpeechUnavailable) as error:
                async for _ in stream_pcm(settings,'讲解',client):
                    pass
        assert error.value.code=='speech_invalid_audio' and 'private-key' not in str(error.value)
    asyncio.run(scenario())


def test_cancel_pcm_disconnects_the_provider_stream(tmp_path):
    async def scenario():
        closed=asyncio.Event()
        class Audio(httpx.AsyncByteStream):
            async def __aiter__(self):
                try:
                    yield b'\x01\x00'*500
                    await asyncio.Event().wait()
                finally:
                    closed.set()
        async def source():
            yield {'event':'delta','data':{'text':'讲解。'}}
            yield {'event':'result','data':{}}
        settings=configuration(tmp_path,speech_enabled=True,speech_api_key='test-key')
        events=stream_voice(source(),settings,httpx.MockTransport(lambda request:
            httpx.Response(200,stream=Audio())),audio_format='pcm')
        async with asyncio.timeout(3):
            async for event in events:
                if event['event']=='audio_chunk':
                    break
            await events.aclose()
            await closed.wait()
    asyncio.run(scenario())
