import copy
import json
import math
import shutil
import subprocess
from pathlib import Path

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.pottery import apply_batch, measurements
from app.pottery_geometry import SECTION_NAMES, geometry_stats, grid
from app.workbench_schemas import Document, ToolCall
from test_workbench import document, create, tool, ack
from test_backend import backend


def apply(doc, *calls, undo=None, redo=None):
    return apply_batch(doc, undo or [], redo or [], [ToolCall(tool=name, arguments=args) for name, args in calls])


@pytest.mark.parametrize('shape', [key for key in SECTION_NAMES if key != 'custom'])
def test_actual_geometry_is_valid_for_all_outlines(shape):
    result = apply(document(), ('set_base_shape', {'shape': 'bowl'}), ('set_cross_section', {'shape': shape}))
    doc = result['document']
    rows = grid(doc)
    assert all(math.isfinite(value) and .14 <= value <= 2.9 for row in rows for value in row)
    assert doc['view']['direction'] == 'top' and not doc['wheel']['rotating']
    assert len(result['undo']) == 1
    if shape != 'circle':
        assert max(rows[-1]) - min(rows[-1]) > .1
    if shape == 'heart':
        # The central notch points upward in the top view and is deeper than both lobes.
        assert rows[-1][64] < rows[-1][48] and rows[-1][64] < rows[-1][80]
    assert measurements(doc)['diameter_cm'] == pytest.approx(geometry_stats(doc)['diameter_cm'], abs=.0001)


def test_named_regions_and_single_side_preserve_other_areas():
    original = document()
    result = apply(original, ('reshape_region', {'part': 'belly', 'side': 'left', 'radius_scale_percent': -12}))
    rows, before = grid(result['document']), grid(original)
    assert rows[0] == before[0] and rows[-1] == before[-1]
    center = result['document']['deformations'][0]['angle_deg']
    affected = round(center % 360 / 360 * 128) % 128
    opposite = (affected + 64) % 128
    assert rows[38][affected] < before[38][affected]
    assert rows[38][opposite] == before[38][opposite]
    assert not result['document']['wheel']['rotating']
    smooth = apply(result['document'], ('smooth_surface', {'part': 'belly', 'side': 'left', 'strength': 1}))
    assert not smooth['document']['deformations']
    assert original == document()


def test_only_the_mouth_changes_shape_and_a_second_region_can_differ():
    original = document()
    first = apply(original, ('set_cross_section', {'shape': 'heart', 'part': 'mouth'}))['document']
    original_grid, first_grid = grid(original), grid(first)
    assert first_grid[:80] == original_grid[:80]
    assert first_grid[95] != original_grid[95]
    second = apply(first, ('set_cross_section', {'shape': 'triangle', 'part': 'lower'}))['document']
    assert second['cross_section']['shape'] == 'circle' and len(second['section_bands']) == 2
    assert grid(second)[95] == first_grid[95]
    assert grid(second)[20] != first_grid[20]


def test_compound_command_undo_restores_every_change_and_redo_preserves_shape():
    original = document()
    result = apply(original, ('set_base_shape', {'shape': 'bowl'}), ('set_cross_section', {'shape': 'heart'}),
                   ('set_dimensions', {'height_cm': 15}), ('set_material', {'material': 'blue'}))
    assert len(result['undo']) == 1
    undone = apply(result['document'], ('undo', {}), undo=result['undo'])
    assert undone['document'] == original
    redone = apply(undone['document'], ('redo', {}), undo=undone['undo'], redo=undone['redo'])
    assert redone['document'] == result['document']


def test_invalid_geometry_and_custom_points_are_rejected_atomically():
    original = document()
    with pytest.raises(HTTPException):
        apply(original, ('set_material', {'material': 'blue'}),
              ('reshape_region', {'part': 'whole', 'side': 'front', 'radius_delta_cm': -6}))
    with pytest.raises(HTTPException):
        apply(original, ('set_cross_section', {'shape': 'custom', 'points': [
            {'angle_deg': 180, 'radius_ratio': 1}, {'angle_deg': 0, 'radius_ratio': .4}, {'angle_deg': 270, 'radius_ratio': .8}]}))
    assert original == document()
    with pytest.raises(ValidationError):
        ToolCall(tool='reshape_region', arguments={'part': 'mouth', 'start_height_ratio': .2, 'end_height_ratio': .5, 'radius_delta_cm': 1})


def test_old_saved_documents_gain_defaults_and_pose_sync_does_not_add_history(backend):
    app, client = backend
    project, headers = create(client)
    from app.models import PotteryProject
    with app.state.db_factory() as db:
        stored = db.get(PotteryProject, project['id'])
        old = copy.deepcopy(stored.document)
        for key in ('cross_section', 'section_bands', 'deformations'):
            old.pop(key)
        old['wheel'].pop('rotation_deg')
        stored.document = old
        db.commit()
    route = '/api/v1/workbenches/' + project['id']
    state = client.get(route, headers=headers).json()['data']['project']
    assert state['document']['cross_section']['shape'] == 'circle'
    from uuid import uuid4
    doc = copy.deepcopy(state['document'])
    doc['wheel']['rotation_deg'] = 46
    response = client.post(route + '/sync', headers=headers, json={'document': doc, 'expected_revision': state['revision'], 'client_request_id': str(uuid4())})
    assert response.status_code == 200, response.text
    assert response.json()['data']['project']['undo_count'] == 0
    state = response.json()['data']['project']
    queued = tool(client, state, headers, 'set_cross_section', {'shape': 'triangle'}).json()['data']
    assert ack(client, state, headers, queued['command']).status_code == 200


def test_followup_keeps_the_previous_part_and_side(backend):
    _, client = backend
    project, headers = create(client)
    queued = tool(client, project, headers, 'reshape_region', {'part': 'belly', 'side': 'left', 'radius_scale_percent': 10}).json()['data']
    fixed_angle = queued['command']['document']['deformations'][-1]['angle_deg']
    project = ack(client, project, headers, queued['command']).json()['data']['project']
    changed_view = tool(client, project, headers, 'set_view', {'direction': 'front'}).json()['data']
    project = ack(client, project, headers, changed_view['command']).json()['data']['project']
    from uuid import uuid4
    route = '/api/v1/workbenches/' + project['id']
    result = client.post(route + '/commands', headers=headers, json={'text': '再收窄一点', 'expected_revision': project['revision'], 'client_request_id': str(uuid4())})
    assert result.status_code == 200, result.text
    command = result.json()['data']['command']
    assert command['source'] == 'local'
    args = command['actions'][0]['arguments']
    assert (args['start_height_ratio'], args['end_height_ratio'], args['radius_scale_percent']) == (.22, .58, -8)
    assert args['angle_deg'] == fixed_angle
    assert ack(client, project, headers, command).status_code == 200


def test_python_and_browser_geometry_agree_and_export_mesh_is_closed():
    fixtures = []
    for shape in SECTION_NAMES:
        args = {'shape': shape}
        if shape == 'custom':
            args['points'] = [{'angle_deg': 0, 'radius_ratio': 1}, {'angle_deg': 70, 'radius_ratio': .5},
                              {'angle_deg': 180, 'radius_ratio': .8}, {'angle_deg': 270, 'radius_ratio': .6}]
        doc = apply(document(), ('set_base_shape', {'shape': 'bowl'}), ('set_cross_section', args))['document']
        fixtures.append({'document': doc, 'stats': geometry_stats(doc), 'samples': [grid(doc)[i][j] for i in (0, 38, 95) for j in (0, 16, 32, 64, 96)]})
    local = apply(document(), ('set_cross_section', {'shape': 'heart', 'part': 'mouth'}),
                  ('reshape_region', {'part': 'belly', 'side': 'right', 'radius_scale_percent': 15}))['document']
    fixtures.append({'document': local, 'stats': geometry_stats(local), 'samples': [grid(local)[i][j] for i in (0, 38, 95) for j in (0, 16, 32, 64, 96)]})
    node = shutil.which('node') or str(Path.home() / '.local/bin/node')
    if not Path(node).is_file():
        pytest.skip('Node.js is required for the cross-language mesh check')
    result = subprocess.run([node, 'tests/pottery_geometry.test.cjs'], input=json.dumps(fixtures),
                            cwd=Path(__file__).resolve().parents[1], capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stdout + result.stderr
    assert '13 geometry fixtures passed' in result.stdout
