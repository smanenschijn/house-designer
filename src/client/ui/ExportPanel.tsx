import { useMemo, useState } from 'react';
import type { House } from '../../shared/house';
import { floorplanPrintHtml, floorplanSvg } from '../../shared/floorplan';
import { useApp, visiblePlacements } from '../store';
import { Icon } from './Icon';

const today = () => new Date().toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' });
const attr = (svg: string, name: string) => new RegExp(`data-${name}="([^"]*)"`).exec(svg)?.[1] ?? '';
const unescape = (s: string) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** SVG → PNG (3 px per cm in de tekening: scherp genoeg om in te zoomen) */
async function svgToPng(svg: string, title: string, sub: string): Promise<Blob> {
  const vb = /viewBox="([^"]+)"/.exec(svg)![1].split(' ').map(Number);
  const px = 3;
  const head = 110;
  const w = Math.round(vb[2] * px);
  const h = Math.round(vb[3] * px);
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svg.replace(/width="[^"]*mm" height="[^"]*mm"/, `width="${w}" height="${h}"`)], { type: 'image/svg+xml' }));
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error('Plattegrond tekenen mislukt'));
    img.src = url;
  });
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h + head;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#1c1c1c';
  ctx.font = '600 38px Inter, Helvetica, Arial, sans-serif';
  ctx.fillText(title, 40, 58);
  ctx.fillStyle = '#555';
  ctx.font = '26px Inter, Helvetica, Arial, sans-serif';
  ctx.fillText(sub, 40, 94);
  ctx.drawImage(img, 0, head, w, h);
  URL.revokeObjectURL(url);
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('PNG maken mislukt'))), 'image/png'));
}

/** Plattegrond per verdieping exporteren: afdrukken/PDF (A4 op schaal), PNG of SVG. */
export function ExportPanel({ house }: { house: House }) {
  const setPanel = useApp((s) => s.setPanel);
  const level = useApp((s) => s.level);
  const placements = useApp((s) => s.placements);
  const variants = useApp((s) => s.variants);
  const active = useApp((s) => s.active);
  const items = useApp((s) => s.items);
  const [levels, setLevels] = useState<number[]>(level === 'all' ? house.levels.map((_, i) => i) : [level]);
  const [furniture, setFurniture] = useState(true);
  const [dims, setDims] = useState(true);
  const [busy, setBusy] = useState(false);

  const plans = useMemo(() => {
    const visible = visiblePlacements({ placements, variants, active });
    return [...levels]
      .sort()
      .map((i) => {
        const svg = floorplanSvg(house, i, visible, items, { furniture, dims, date: today() });
        return { level: house.levels[i], svg, title: unescape(attr(svg, 'title')), sub: unescape(attr(svg, 'sub')) };
      });
  }, [levels, furniture, dims, placements, variants, active, items, house]);

  const toggle = (i: number) => setLevels((l) => (l.includes(i) ? l.filter((x) => x !== i) : [...l, i]));

  const print = () => {
    const html = floorplanPrintHtml(house, plans);
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    document.body.appendChild(frame);
    const doc = frame.contentWindow!.document;
    doc.open();
    doc.write(html);
    doc.close();
    const go = () => {
      frame.contentWindow!.focus();
      frame.contentWindow!.print();
      setTimeout(() => frame.remove(), 60_000);
    };
    // even wachten tot de lettertypes en SVG's klaar zijn
    setTimeout(go, 300);
  };

  const png = async () => {
    setBusy(true);
    try {
      for (const p of plans) download(`plattegrond-${p.level.id}.png`, await svgToPng(p.svg, p.title, p.sub));
    } catch (e) {
      useApp.getState().setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const svg = () => {
    for (const p of plans) download(`plattegrond-${p.level.id}.svg`, new Blob([p.svg], { type: 'image/svg+xml' }));
  };

  return (
    <aside className="panel export glass">
      <div className="panel-head">
        <h2>Plattegrond</h2>
        <button className="ghost close" onClick={() => setPanel(null)} aria-label="Sluiten">
          <Icon name="close" />
        </button>
      </div>
      <div className="editor-body">
        <div className="field">
          <span>Verdiepingen</span>
          {house.levels.map((l, i) => (
            <label key={l.id} className="check">
              <input type="checkbox" checked={levels.includes(i)} onChange={() => toggle(i)} /> {l.name}
            </label>
          ))}
        </div>
        <div className="field">
          <span>Tonen</span>
          <label className="check">
            <input type="checkbox" checked={furniture} onChange={(e) => setFurniture(e.target.checked)} /> Meubels (actieve indelingen)
          </label>
          <label className="check">
            <input type="checkbox" checked={dims} onChange={(e) => setDims(e.target.checked)} /> Maten (buitenmaten en kamermaten)
          </label>
        </div>
        <div className="export-previews">
          {plans.map((p) => (
            <figure key={p.level.id} className="export-preview">
              {/* als afbeelding: de stijlen in de SVG mogen niet in de app lekken */}
              <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(p.svg)}`} alt={`Plattegrond ${p.level.name}`} />
              <figcaption>
                {p.level.name} · {p.sub.split(' · ')[0]}
              </figcaption>
            </figure>
          ))}
        </div>
        <p className="muted small-text">Afdrukken op A4 staand, op schaal. Kies in het afdrukvenster “Opslaan als PDF” voor een PDF.</p>
      </div>
      <div className="panel-foot">
        <button onClick={svg} disabled={!plans.length}>
          SVG
        </button>
        <button onClick={png} disabled={!plans.length || busy}>
          {busy ? 'Bezig…' : 'PNG'}
        </button>
        <button className="primary" onClick={print} disabled={!plans.length}>
          Afdrukken / PDF
        </button>
      </div>
    </aside>
  );
}
