const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {webcrypto} = require('node:crypto');
const context = {window: {}, AbortController, DOMException, TypeError, crypto: webcrypto};
vm.runInNewContext(fs.readFileSync('app/static/ui-controls.js', 'utf8'), context);
const Controller = context.window.HeritageUIController;
const item = {id: 'C001', hotspots: [{key: 'bowl-center'}]};

function fixture({holdPlan = false, failReceipt = false, failPlayback = false} = {}) {
  let session = {id: 'visitor', revision: 1, current_item_id: 'paper', current_hotspot_id: null};
  let server = {...session}, view = {item_id: 'paper', hotspot_id: null};
  let applyCount = 0, acknowledgements = 0, resolvePlan;
  const action = {id: 'action-1', type: failPlayback ? 'audio_resume' : 'open_item',
    item_id: failPlayback ? 'paper' : 'C001', hotspot_id: null, expected_revision: 2,
    expires_at: new Date(Date.now() + 60000).toISOString()};
  const client = new Controller({
    api: async (path, method, body) => {
      if (path.endsWith('state')) return {session: {...server}, pending_action: null};
      if (path.endsWith('cancel')) {server.revision++; return {session: {...server}, pending_action: null};}
      if (path.endsWith('plan')) {
        if (holdPlan) await new Promise(resolve => { resolvePlan = resolve; });
        server.revision = 2;
        return {decision: 'action', session: {...server}, action};
      }
      if (path.endsWith('receipt')) {
        acknowledgements++;
        if (failReceipt) throw Error('receipt rejected');
        if (body.status === 'applied') server.current_item_id = action.item_id;
        server.revision++;
        return {status: body.status, session: {...server}, duplicate: false, message: 'confirmed',
          interaction: body.status === 'applied' ? {event: 'explain', item_id: action.item_id} : null};
      }
      throw Error('Unexpected endpoint');
    },
    getSession: () => session, setSession: next => { session = next; }, ensureSession: async () => {},
    getItems: () => [item], getView: () => view,
    setView: next => { view = next; applyCount++; },
    playback: async () => { throw Error('browser playback blocked'); }
  });
  return {client, view: () => view, applied: () => applyCount, receipts: () => acknowledgements,
    release: () => resolvePlan?.(), planReady: () => !!resolvePlan};
}

(async () => {
  const success = fixture();
  const result = await success.client.run('打开藏品');
  assert.equal(success.view().item_id, 'C001');
  assert.equal(result.interaction.item_id, 'C001');
  assert.equal(success.receipts(), 1);

  const rejected = fixture({failReceipt: true});
  await assert.rejects(rejected.client.run('打开藏品'), /receipt rejected/);
  assert.equal(rejected.view().item_id, 'paper', 'rejected receipt restores confirmed context');

  const late = fixture({holdPlan: true});
  const running = late.client.run('打开藏品');
  while (!late.planReady()) await new Promise(resolve => setImmediate(resolve));
  await late.client.cancel();
  late.release();
  await assert.rejects(running, {name: 'AbortError'});
  assert.equal(late.view().item_id, 'paper', 'late plan must never open another item');
  assert.equal(late.receipts(), 0);

  const blocked = fixture({failPlayback: true});
  const failure = await blocked.client.run('继续播放');
  assert.equal(failure.decision, 'clarify');
  assert.equal(failure.interaction, null);
  assert.match(failure.message, /blocked/);
  console.log('4 interface-controller checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
