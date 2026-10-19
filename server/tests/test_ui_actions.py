from datetime import timedelta
from uuid import uuid4

import pytest
from sqlalchemy import func, select

from app.models import HeritageItem, ModelCall, UIAction, utcnow
from test_backend import backend, admin_headers, session, interact

ACTIONS = ['open_item', 'focus_hotspot', 'audio_pause', 'audio_resume', 'audio_repeat', 'audio_stop']


def plan(client, sid, headers, text, **overrides):
    state = client.get('/api/v1/sessions/' + sid, headers=headers).json()['data']
    body = dict(text=text, expected_revision=state['revision'], client_request_id=str(uuid4()), supported_actions=ACTIONS)
    body.update(overrides)
    return client.post('/api/v1/sessions/' + sid + '/ui/plan', headers=headers, json=body), body


def receipt(client, sid, headers, action, status='applied', **overrides):
    body = dict(expected_revision=action['expected_revision'], status=status,
                actual_item_id=action['item_id'], actual_hotspot_id=action['hotspot_id'])
    body.update(overrides)
    return client.post('/api/v1/sessions/' + sid + '/ui/actions/' + action['id'] + '/receipt', headers=headers, json=body)


@pytest.mark.parametrize('text', ['打开剪纸', '请帮我打开剪纸', '带我看看剪纸', '介绍一下剪纸', '切换到 paper-cutting',
                                '我想看看剪纸', '可以帮我打开剪纸吗', '帮我把剪纸打开'])
def test_open_is_fast_and_context_waits_for_receipt(backend, text):
    app, client = backend
    sid, auth = session(client, item_id='bamboo-weaving')
    response, _ = plan(client, sid, auth, text)
    assert response.status_code == 200, response.text
    data = response.json()['data']
    assert data['resolver'] == 'local_commands'
    assert data['action']['type'] == 'open_item' and data['action']['item_id'] == 'paper-cutting'
    assert data['session']['current_item_id'] == 'bamboo-weaving'
    assert '已打开' not in data['message']
    with app.state.db_factory() as db:
        assert db.scalar(select(func.count()).select_from(ModelCall)) == 0
    ack = receipt(client, sid, auth, data['action']).json()['data']
    assert ack['session']['current_item_id'] == 'paper-cutting'
    assert ack['interaction'] == {'event': 'explain', 'item_id': 'paper-cutting', 'hotspot_id': None, 'question': None}
    assert ack['session']['turn_count'] == 0
    assert '已打开' in ack['message']
    reply = interact(client, sid, auth, event='explain', item_id='paper-cutting')
    assert reply.status_code == 200
    assert reply.json()['data']['session']['turn_count'] == 1


def test_focus_other_item_then_followup_uses_that_part(backend):
    _, client = backend
    sid, auth = session(client, item_id='shadow-puppet')
    response, _ = plan(client, sid, auth, '请带我看看剪纸的镂空纹样')
    action = response.json()['data']['action']
    assert (action['type'], action['item_id'], action['hotspot_id']) == ('focus_hotspot', 'paper-cutting', 'pattern')
    ack = receipt(client, sid, auth, action).json()['data']
    assert ack['session']['current_hotspot_id'] == 'pattern'
    assert ack['interaction']['event'] == 'hotspot'
    answer = interact(client, sid, auth, event='ask', question='这个有什么作用？').json()['data']
    assert any(source['id'] == 'hotspot:pattern' for source in answer['sources'])
    assert answer['actions'] == []


@pytest.mark.parametrize('text,decision', [
    ('这个物品有什么用途？', 'ask'), ('讲讲为什么使用这种材料', 'ask'),
    ('不要打开剪纸', 'clarify'), ('打开皮影然后打开竹编', 'clarify'),
    ('看看不存在的部位', 'clarify'), ('打开不存在的展品', 'clarify'),
    ('请执行 javascript:alert(1)', 'ask')])
def test_questions_negative_unknown_and_compound_do_not_execute(backend, text, decision):
    _, client = backend
    sid, auth = session(client, item_id='paper-cutting')
    response, _ = plan(client, sid, auth, text)
    assert response.status_code == 200
    data = response.json()['data']
    assert data['decision'] == decision and data['action'] is None
    assert data['session']['current_item_id'] == 'paper-cutting'


def test_ambiguous_and_hidden_targets_and_missing_capability(backend):
    _, client = backend
    auth = admin_headers(client)
    for ident, name, published in [('a', '花瓶甲', True), ('b', '花瓶乙', True), ('secret', '秘密藏品', False)]:
        assert client.post('/api/v1/admin/items', headers=auth, json={
            'id': ident, 'name': name, 'category': '陶瓷', 'summary': '摘要',
            'introduction': '项目资料', 'published': published}).status_code == 201
    sid, visitor = session(client, item_id='paper-cutting')
    result, _ = plan(client, sid, visitor, '打开花瓶')
    data = result.json()['data']
    assert data['decision'] == 'clarify' and len(data['choices']) == 2
    assert {choice['text'] for choice in data['choices']} == {'打开 a', '打开 b'}
    unknown, _ = plan(client, sid, visitor, '打开秘密藏品')
    assert unknown.json()['data']['action'] is None
    assert '秘密藏品' not in str(unknown.json()['data']['choices'])
    unsupported, _ = plan(client, sid, visitor, '打开皮影', supported_actions=['audio_pause'])
    assert unsupported.json()['data']['decision'] == 'clarify'
    assert unsupported.json()['data']['action'] is None


def test_action_and_receipt_idempotency_and_foreign_session_auth(backend):
    _, client = backend
    sid, auth = session(client, item_id='paper-cutting')
    response, body = plan(client, sid, auth, '打开皮影')
    action = response.json()['data']['action']
    route = '/api/v1/sessions/' + sid + '/ui/plan'
    repeat = client.post(route, headers=auth, json=body).json()['data']
    assert repeat['action']['id'] == action['id']
    assert client.post(route, headers=auth, json={**body, 'text': '打开剪纸'}).status_code == 409
    other, other_auth = session(client, item_id='paper-cutting')
    assert client.post(route, json=body).status_code == 404
    assert client.post(route, headers=other_auth, json=body).status_code == 404
    assert receipt(client, other, other_auth, action).status_code == 404
    first = receipt(client, sid, auth, action).json()['data']
    second = receipt(client, sid, auth, action).json()['data']
    assert first['duplicate'] is False and second['duplicate'] is True
    assert second['interaction'] is None
    assert second['session']['revision'] == first['session']['revision']
    assert client.post(route, headers=auth, json=body).json()['data']['decision'] == 'completed'
    assert receipt(client, sid, auth, action, status='failed').status_code == 409


def test_pending_action_blocks_lecture_and_new_command_invalidates_old(backend):
    _, client = backend
    sid, auth = session(client, item_id='paper-cutting')
    first, _ = plan(client, sid, auth, '打开皮影')
    old = first.json()['data']['action']
    assert interact(client, sid, auth, event='ask', question='这个是什么？').status_code == 409
    new, _ = plan(client, sid, auth, '看看镂空纹样')
    action = new.json()['data']['action']
    assert receipt(client, sid, auth, old).status_code == 409
    state = client.get('/api/v1/sessions/' + sid + '/ui/state', headers=auth).json()['data']
    assert state['pending_action']['id'] == action['id']
    cancelled = receipt(client, sid, auth, action, status='cancelled').json()['data']
    assert cancelled['interaction'] is None and cancelled['session']['current_item_id'] == 'paper-cutting'
    assert interact(client, sid, auth, event='ask', question='它是什么？').status_code == 200


def test_bad_or_expired_receipts_do_not_commit_context(backend):
    app, client = backend
    sid, auth = session(client, item_id='paper-cutting')
    result, _ = plan(client, sid, auth, '打开皮影')
    action = result.json()['data']['action']
    assert receipt(client, sid, auth, action, actual_item_id='bamboo-weaving').status_code == 422
    assert receipt(client, sid, auth, action, expected_revision=1).status_code == 409
    with app.state.db_factory() as db:
        db.get(UIAction, action['id']).expires_at = utcnow() - timedelta(seconds=1)
        db.commit()
    assert receipt(client, sid, auth, action).status_code == 410
    assert client.get('/api/v1/sessions/' + sid, headers=auth).json()['data']['current_item_id'] == 'paper-cutting'
    assert client.get('/api/v1/sessions/' + sid + '/ui/state', headers=auth).json()['data']['pending_action'] is None


def test_manual_context_cancels_old_action_and_validates_hotspot(backend):
    _, client = backend
    sid, auth = session(client, item_id='paper-cutting')
    result, _ = plan(client, sid, auth, '打开皮影')
    action = result.json()['data']['action']
    path = '/api/v1/sessions/' + sid + '/ui/context'
    body = {'expected_revision': action['expected_revision'], 'item_id': 'bamboo-weaving', 'hotspot_id': 'missing'}
    assert client.post(path, headers=auth, json=body).status_code == 404
    body['hotspot_id'] = 'weave'
    response = client.post(path, headers=auth, json=body)
    assert response.status_code == 200
    assert response.json()['data']['session']['current_hotspot_id'] == 'weave'
    assert receipt(client, sid, auth, action).status_code == 409
    assert client.post(path, headers=auth, json=body).status_code == 409


@pytest.mark.parametrize('text,action_type,state', [('暂停讲解', 'audio_pause', 'paused'),
    ('请继续播放', 'audio_resume', 'playing'), ('再讲一遍', 'audio_repeat', 'playing'), ('停止讲解', 'audio_stop', 'stopped')])
def test_playback_requires_matching_player_result(backend, text, action_type, state):
    _, client = backend
    sid, auth = session(client, item_id='paper-cutting')
    result, _ = plan(client, sid, auth, text)
    action = result.json()['data']['action']
    assert action['type'] == action_type
    assert receipt(client, sid, auth, action).status_code == 422
    ack = receipt(client, sid, auth, action, playback_state=state).json()['data']
    assert ack['status'] == 'applied' and ack['interaction'] is None
    assert ack['session']['turn_count'] == 0


def test_failed_and_unpublished_action_never_claim_completion(backend):
    app, client = backend
    sid, auth = session(client, item_id='paper-cutting')
    result, _ = plan(client, sid, auth, '打开皮影')
    action = result.json()['data']['action']
    failed = receipt(client, sid, auth, action, status='failed').json()['data']
    assert failed['status'] == 'failed' and failed['interaction'] is None
    assert '已打开' not in failed['message']
    result, _ = plan(client, sid, auth, '打开皮影')
    action = result.json()['data']['action']
    with app.state.db_factory() as db:
        db.get(HeritageItem, 'shadow-puppet').published = False
        db.commit()
    assert receipt(client, sid, auth, action).status_code == 404
    assert client.get('/api/v1/sessions/' + sid, headers=auth).json()['data']['current_item_id'] == 'paper-cutting'


def test_unknown_action_types_are_rejected(backend):
    _, client = backend
    sid, auth = session(client, item_id='paper-cutting')
    response, _ = plan(client, sid, auth, '打开剪纸', supported_actions=['run_javascript'])
    assert response.status_code == 422


def test_cancel_invalidates_even_a_plan_not_yet_received(backend):
    _, client = backend
    sid, auth = session(client, item_id='paper-cutting')
    state = client.get('/api/v1/sessions/' + sid, headers=auth).json()['data']
    cancelled = client.post('/api/v1/sessions/' + sid + '/ui/cancel', headers=auth,
                            json={'expected_revision': state['revision']})
    assert cancelled.status_code == 200
    late, _ = plan(client, sid, auth, '打开皮影', expected_revision=state['revision'])
    assert late.status_code == 409
    result, _ = plan(client, sid, auth, '打开皮影')
    action = result.json()['data']['action']
    assert client.post('/api/v1/sessions/' + sid + '/ui/cancel', headers=auth,
                       json={'expected_revision': action['expected_revision']}).status_code == 200
    assert receipt(client, sid, auth, action).status_code == 409


def test_identical_names_can_be_disambiguated_with_exact_ids(backend):
    _, client = backend
    auth = admin_headers(client)
    for ident in ['vase-a', 'vasea']:
        assert client.post('/api/v1/admin/items', headers=auth, json={
            'id': ident, 'name': '莲纹花瓶', 'category': '陶瓷', 'summary': '摘要',
            'introduction': '项目资料', 'published': True}).status_code == 201
    sid, visitor = session(client, item_id='paper-cutting')
    ambiguous, _ = plan(client, sid, visitor, '打开莲纹花瓶')
    assert ambiguous.json()['data']['decision'] == 'clarify'
    choices = ambiguous.json()['data']['choices']
    assert len(choices) == 2
    for choice in choices:
        resolved, _ = plan(client, sid, visitor, choice['text'])
        assert resolved.json()['data']['decision'] == 'action'
        assert resolved.json()['data']['action']['item_id'] == choice['text'].split()[1]
