"""Export the integrated source plus a fresh database containing only content tables."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import zipfile

SERVER = Path(__file__).resolve().parents[1]
ROOT = SERVER.parent
sys.path.insert(0, str(SERVER))
from app.workbench_schemas import Document  # noqa: E402
from dotenv import dotenv_values  # noqa: E402

CONTENT_TABLES = ('heritage_items', 'hotspots', 'knowledge_entries', 'tours', 'alembic_version')
DIRECTORIES = ('css', 'js', 'tests', 'server/app', 'server/migrations', 'server/scripts', 'server/tests', 'server/docs')
FILES = ('index.html', 'README.md', '承艺_交接文档.md', '整合交接说明.md', 'CONTRIBUTING.md', 'CLAUDE.md',
         '.gitignore', '.gitattributes', '.nojekyll', '启动承艺.command', '启动承艺-Windows.bat', 'start.command',
         'server/requirements.txt', 'server/pyproject.toml', 'server/alembic.ini', 'server/.env.example',
         'server/.gitignore', 'server/.dockerignore', 'server/Dockerfile', 'server/README.md',
         'server/启动后台.command', 'server/启动工作台-Mac.command', 'server/启动工作台-Windows.bat')
SUFFIXES = {'.py', '.js', '.cjs', '.css', '.html', '.json', '.md', '.txt', '.mako', '.ini'}
EXCLUDED = {'__pycache__', '.pytest_cache', '.git', '.venv', '.env', '.local-credentials.txt',
            '后台账号.txt', '临时工作台网址.txt', '启动日志.txt', '.DS_Store'}


def json_file(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def export_data(destination):
    destination.mkdir(parents=True)
    source = SERVER / 'data/heritage.db'
    if not source.is_file():
        raise RuntimeError('当前没有可导出的SQLite数据，请先初始化后台。')
    counts = {}
    # A consistent in-memory snapshot never writes private chat/session rows into the delivered database.
    with sqlite3.connect('file:' + str(source) + '?mode=ro', uri=True) as live, sqlite3.connect(':memory:') as snapshot:
        live.backup(snapshot)
        with sqlite3.connect(destination / 'heritage-clean.sqlite3') as clean:
            objects = snapshot.execute("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND type='table' AND name NOT LIKE 'sqlite_%'").fetchall()
            for (sql,) in objects:
                clean.execute(sql)
            for (sql,) in snapshot.execute("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND type='index'"):
                clean.execute(sql)
            catalog = {}
            for table in CONTENT_TABLES:
                cursor = snapshot.execute('SELECT * FROM "' + table + '"')
                columns = [column[0] for column in cursor.description]
                rows = cursor.fetchall()
                if rows:
                    clean.executemany('INSERT INTO "' + table + '" VALUES (' + ','.join('?' for _ in columns) + ')', rows)
                catalog[table] = [dict(zip(columns, row)) for row in rows]
                counts[table] = len(rows)
            clean.commit()
            assert clean.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
            assert clean.execute('PRAGMA foreign_key_check').fetchall() == []
            for (table,) in clean.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"):
                if table not in CONTENT_TABLES:
                    assert clean.execute('SELECT COUNT(*) FROM "' + table + '"').fetchone()[0] == 0
            (destination / 'schema-and-content.sql').write_text('\n'.join(clean.iterdump()) + '\n', encoding='utf-8')
        json_file(destination / 'catalog.json', catalog)
        works = []
        work_directory = destination / 'works'
        work_directory.mkdir()
        for index, (document, undo, redo, saved_at, updated_at) in enumerate(snapshot.execute(
                'SELECT document, undo, redo, saved_at, updated_at FROM pottery_projects ORDER BY updated_at, id'), start=1):
            doc = Document.model_validate_json(document).model_dump()
            ident = f'work-{index:04d}'
            works.append({'export_id': ident, 'document': doc,
                          'undo': [Document.model_validate(value).model_dump() for value in json.loads(undo)],
                          'redo': [Document.model_validate(value).model_dump() for value in json.loads(redo)],
                          'saved_at': saved_at, 'updated_at': updated_at})
            json_file(work_directory / (ident + '.json'), {'format': 'taowu-pottery', 'version': 2, **doc})
        json_file(destination / 'works.json', {'version': 1, 'works': works})
        counts['work_snapshots'] = len(works)
    return counts


def source_files():
    paths = set()
    for directory in DIRECTORIES:
        for path in (ROOT / directory).rglob('*'):
            if not path.is_file() or path.is_symlink() or set(path.relative_to(ROOT).parts) & EXCLUDED:
                continue
            if path.suffix in SUFFIXES:
                paths.add(path)
    for name in FILES:
        path = ROOT / name
        if not path.is_file():
            raise RuntimeError('源码缺少文件：' + name)
        paths.add(path)
    return sorted(paths)


def export(output):
    output.mkdir(parents=True, exist_ok=True)
    known_secrets = [str(value).encode() for key, value in dotenv_values(SERVER / '.env').items()
                     if value and any(word in key for word in ('KEY', 'PASSWORD')) and len(str(value)) >= 12]
    stamp = datetime.now().strftime('%Y%m%d')
    filename = output / ('承艺整合版-源码与数据-' + stamp + '.zip')
    with tempfile.TemporaryDirectory(prefix='chengyi-handoff-') as temporary:
        top = Path(temporary) / '承艺整合版-源码与数据'
        for source in source_files():
            target = top / source.relative_to(ROOT)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
        counts = export_data(top / 'server/handoff')
        files = []
        for path in sorted(top.rglob('*')):
            if not path.is_file():
                continue
            payload = path.read_bytes()
            if any(secret in payload for secret in known_secrets):
                raise RuntimeError('交接文件中发现本机凭据，未生成压缩包。')
            files.append({'path': path.relative_to(top).as_posix(), 'bytes': len(payload), 'sha256': hashlib.sha256(payload).hexdigest()})
        try:
            base = subprocess.check_output(['git', '-C', str(ROOT), 'rev-parse', 'HEAD'], text=True).strip()
        except (subprocess.CalledProcessError, FileNotFoundError):
            base = 'see source documentation'
        json_file(top / '交接清单.json', {'generated_at': datetime.now(timezone.utc).isoformat(),
                  'upstream': 'https://github.com/ZeroOnehub/chengyi',
                  'upstream_commit': '6a113f4c587b885ec40d8f8376c73b2264609115', 'source_commit': base,
                  'counts': counts, 'excluded': ['API密钥', '管理员账号密码', '访客凭证', '对话和操作日志', '录音', '原始数据库', 'Git历史'],
                  'dify_cloud_documents_included': False, 'files': files})
        with zipfile.ZipFile(filename, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            for path in sorted(top.rglob('*')):
                if path.is_file():
                    archive.write(path, path.relative_to(top.parent).as_posix())
        with zipfile.ZipFile(filename) as archive:
            assert archive.testzip() is None
            assert not any(set(Path(name).parts) & EXCLUDED for name in archive.namelist())
            assert not any('/server/data/' in name for name in archive.namelist())
            assert any(name.endswith('/js/data/crafts.js') for name in archive.namelist())
    print('交接包：' + str(filename))
    print('数据数量：' + json.dumps(counts, ensure_ascii=False))
    print('大小：%.2f MB' % (filename.stat().st_size / 1048576))
    return filename


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output-dir', type=Path, default=ROOT / 'exports')
    args = parser.parse_args()
    export(args.output_dir.resolve())
