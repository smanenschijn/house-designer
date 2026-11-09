import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Headless Blender op de server: voert een bpy-script uit en exporteert het resultaat als GLB.
 *
 * Afscherming: het script draait als aparte gebruiker (BLENDER_UID, zonder toegang tot /data),
 * met een lege omgeving (geen geheimen), in een tijdelijke map en met een tijdslimiet.
 */

const TIMEOUT_MS = Number(process.env.BLENDER_TIMEOUT_MS ?? 180_000);

export function blenderPath(): string | null {
  const candidates = [process.env.BLENDER_PATH, '/usr/bin/blender', '/usr/local/bin/blender', '/Applications/Blender.app/Contents/MacOS/Blender'];
  return candidates.find((p) => p && existsSync(p)) ?? null;
}

const WRAPPER = `
import bpy, sys, math, traceback
args = sys.argv[sys.argv.index('--') + 1:]
OUT, SRC = args[0], args[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.scene.unit_settings.system = 'METRIC'
try:
    code = open(SRC, encoding='utf-8').read()
    exec(compile(code, 'model.py', 'exec'), {'__name__': '__main__', 'bpy': bpy, 'math': math})
except Exception as e:
    print('@@FOUT@@')
    # zonder de regel van deze wrapper: alleen de fout in het script zelf
    traceback.print_exception(type(e), e, e.__traceback__.tb_next, file=sys.stdout)
    sys.stdout.flush()
    sys.exit(3)
if bpy.context.object and bpy.context.object.mode != 'OBJECT':
    bpy.ops.object.mode_set(mode='OBJECT')
objs = [o for o in bpy.context.scene.objects if o.type in ('MESH', 'CURVE', 'SURFACE', 'META', 'FONT')]
if not objs:
    print('@@FOUT@@ Het script heeft geen objecten gemaakt.')
    sys.exit(4)
# curves/tekst omzetten naar mesh zodat ze mee-exporteren
for o in objs:
    if o.type != 'MESH':
        bpy.ops.object.select_all(action='DESELECT')
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.convert(target='MESH')
tris = 0
dg = bpy.context.evaluated_depsgraph_get()
for o in bpy.context.scene.objects:
    if o.type == 'MESH':
        m = o.evaluated_get(dg).to_mesh()
        m.calc_loop_triangles()
        tris += len(m.loop_triangles)
        o.evaluated_get(dg).to_mesh_clear()
print('@@DRIEHOEKEN@@', tris)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_apply=True, export_yup=True,
                          export_cameras=False, export_lights=False)
print('@@KLAAR@@')
`;

export class BlenderError extends Error {
  constructor(
    message: string,
    public log: string,
  ) {
    super(message);
  }
}

let queue: Promise<unknown> = Promise.resolve();

/** één Blender tegelijk (zwaar voor CPU en geheugen) */
export function runBlender(script: string): Promise<{ glb: Buffer; log: string }> {
  const run = queue.then(() => doRun(script));
  queue = run.catch(() => undefined);
  return run;
}

async function doRun(script: string): Promise<{ glb: Buffer; log: string }> {
  const bin = blenderPath();
  if (!bin) throw new BlenderError('Blender is niet geïnstalleerd op de server (bouw de image met WITH_BLENDER=true).', '');
  const dir = mkdtempSync(join(tmpdir(), 'blender-'));
  chmodSync(dir, 0o777);
  const out = join(dir, 'model.glb');
  const src = join(dir, 'model.py');
  const wrapper = join(dir, 'wrapper.py');
  writeFileSync(src, script);
  writeFileSync(wrapper, WRAPPER);
  const uid = Number(process.env.BLENDER_UID);
  const asUser = process.getuid?.() === 0 && uid > 0;
  try {
    const log = await new Promise<string>((resolveRun, reject) => {
      const child = spawn(bin, ['-b', '--factory-startup', '-noaudio', '--python-exit-code', '3', '--python', wrapper, '--', out, src], {
        cwd: dir,
        env: { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: dir, TMPDIR: dir, LANG: 'C.UTF-8' },
        ...(asUser ? { uid, gid: Number(process.env.BLENDER_GID ?? uid) } : {}),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let buf = '';
      const add = (d: Buffer) => {
        buf += d.toString();
        if (buf.length > 400_000) buf = buf.slice(-200_000);
      };
      child.stdout.on('data', add);
      child.stderr.on('data', add);
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new BlenderError(`Blender duurde langer dan ${TIMEOUT_MS / 1000} s en is gestopt. Maak het model eenvoudiger (minder subdivisions/array's).`, tail(buf)));
      }, TIMEOUT_MS);
      child.on('error', (e) => {
        clearTimeout(timer);
        reject(new BlenderError(`Blender starten mislukte: ${e.message}`, ''));
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0 && buf.includes('@@KLAAR@@')) resolveRun(buf);
        else {
          const at = buf.indexOf('@@FOUT@@');
          const detail = at >= 0 ? buf.slice(at + 8) : buf;
          reject(new BlenderError(code === 4 ? 'Het script heeft geen objecten gemaakt.' : 'Het Blender-script gaf een fout.', tail(detail)));
        }
      });
    });
    if (!existsSync(out)) throw new BlenderError('Blender maakte geen GLB-bestand.', tail(log));
    return { glb: readFileSync(out), log: tail(log) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** laatste regels van het logboek, zonder Blender-ruis */
function tail(s: string, lines = 40): string {
  return s
    .split('\n')
    .filter((l) => l.trim() && !/Draco|^Blender quit|^Blender \d|^Read prefs|^Color management|INFO Draco|^\d\d:\d\d:\d\d \| INFO/.test(l))
    .slice(-lines)
    .join('\n');
}
