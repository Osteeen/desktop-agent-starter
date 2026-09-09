from pathlib import Path
import json
import os
import shutil
import subprocess
import tempfile

project = Path(__file__).resolve().parents[2]
(project / 'build').mkdir(exist_ok=True)
with tempfile.TemporaryDirectory(dir=project / 'build', prefix='staging-test-') as temp:
    base = Path(temp)
    demo = base / 'demo'
    demo.mkdir()
    # Synthetic home only. Do not change HOME or stage in the real home folders.
    script = (project / 'demo/stage.sh').read_text().replace('$HOME', '$STAGING_TEST_HOME')
    (demo / 'stage.sh').write_text(script)
    shutil.copyfile(project / 'demo/make-fixtures.py', demo / 'make-fixtures.py')
    for case in ['normal', 'symlink-marker', 'parent-swap', 'nested-symlink']:
        home = base / ('home-' + case)
        parent = home / 'dev/parent'
        root = parent / 'sandbox'
        (root / 'Desktop/subdir').mkdir(parents=True)
        original = root / 'Desktop/subdir/original'
        original.write_text('owned')
        outside = base / ('outside-' + case)
        (outside / 'sandbox/Desktop').mkdir(parents=True)
        victim = outside / 'sandbox/Desktop/KEEP'
        victim.write_text('keep')
        marker = root / '.do-over-demo-root'
        if case == 'symlink-marker':
            marker.symlink_to(victim)
        else:
            marker.touch()
        if case == 'nested-symlink':
            (root / 'Desktop/escape').symlink_to(outside, target_is_directory=True)
        env = os.environ.copy()
        env.update(STAGING_TEST_HOME=str(home), DEMO_ROOT=str(root))
        if case == 'parent-swap':
            hooks = base / 'hooks'
            hooks.mkdir()
            (hooks / 'sitecustomize.py').write_text('''import functools, os, shutil
original = shutil.rmtree
swapped = False
@functools.wraps(original)
def hooked(path, *args, **kwargs):
    global swapped
    if not swapped:
        swapped = True
        parent = os.environ['SWAP_PARENT']
        os.rename(parent, parent + '-held')
        os.symlink(os.environ['SWAP_OUTSIDE'], parent)
    return original(path, *args, **kwargs)
shutil.rmtree = hooked
''')
            env.update(PYTHONPATH=str(hooks), SWAP_PARENT=str(parent), SWAP_OUTSIDE=str(outside))
        result = subprocess.run(['bash', str(demo / 'stage.sh'), '--reset'],
                                env=env, capture_output=True, text=True, timeout=20)
        assert victim.read_text() == 'keep', case
        assert sorted(str(p.relative_to(outside)) for p in outside.rglob('*')) == [
            'sandbox', 'sandbox/Desktop', 'sandbox/Desktop/KEEP'], case
        if case in ['parent-swap', 'symlink-marker']:
            assert result.returncode != 0, case
            assert 'refusing:' in result.stderr, result.stderr
        else:
            assert result.returncode == 0, result.stderr
            assert (root / 'Desktop/Q3-report.pdf').is_file(), case
            assert not original.exists(), case
        if case == 'symlink-marker':
            assert original.read_text() == 'owned'
        if case == 'parent-swap':
            assert not (Path(str(parent) + '-held') / 'sandbox/Desktop').exists()
        print(json.dumps({'case': case, 'passed': True, 'outsideUnchanged': True}))
