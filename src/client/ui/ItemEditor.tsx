import { useEffect, useMemo, useState } from 'react';
import { CATEGORIES, RecipeSchema, STATUSES, STATUS_LABELS, type Category, type ItemStatus, type Recipe } from '../../shared/recipe';
import { TEMPLATES, TEMPLATE_MAP, type TemplateParams } from '../../shared/templates';
import { api } from '../api';
import { attempt, useApp } from '../store';
import { modelThumbnail, objectThumbnail, recipeThumbnail } from '../three/thumbnail';
import { loadFileObject } from '../three/glbModel';
import * as THREE from 'three';
import { Icon } from './Icon';

let previewCounter = 0;

type Mode = 'sjabloon' | 'recept' | 'model';

const SCALES = [
  { v: 1, label: 'meter' },
  { v: 0.01, label: 'centimeter' },
  { v: 0.001, label: 'millimeter' },
];

const guessScale = (largest: number) => (largest > 300 ? 0.001 : largest > 15 ? 0.01 : 1);

export function ItemEditor() {
  const editingId = useApp((s) => s.editingItemId);
  const items = useApp((s) => s.items);
  const setPanel = useApp((s) => s.setPanel);
  const existing = items.find((i) => i.id === editingId) ?? null;

  const initialTemplate = existing?.meta.template?.id ?? (existing ? null : 'bank');
  const [mode, setMode] = useState<Mode>(existing?.model ? 'model' : existing && !existing.meta.template ? 'recept' : 'sjabloon');
  // 3D-model (GLB)
  const [file, setFile] = useState<File | null>(null);
  const [fileInfo, setFileInfo] = useState<{ object: THREE.Object3D; size: THREE.Vector3; triangles: number } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [scale, setScale] = useState(existing?.model?.scale ?? 1);
  const [rotation, setRotation] = useState(existing?.model?.rotation ?? 0);
  const [templateId, setTemplateId] = useState<string>(initialTemplate ?? 'bank');
  const [params, setParams] = useState<TemplateParams>(
    () =>
      ({
        ...TEMPLATE_MAP[initialTemplate ?? 'bank'].defaults,
        ...(existing?.meta.template?.params ?? {}),
      }) as TemplateParams,
  );
  const [name, setName] = useState(existing?.name ?? '');
  const [category, setCategory] = useState<Category>(existing?.category ?? TEMPLATE_MAP[templateId].category);
  const [status, setStatus] = useState<ItemStatus>(existing?.meta.status ?? 'overwegen');
  const [price, setPrice] = useState(existing?.meta.price != null ? String(existing.meta.price) : '');
  const [shop, setShop] = useState(existing?.meta.shop ?? '');
  const [url, setUrl] = useState(existing?.meta.url ?? '');
  const [notes, setNotes] = useState(existing?.meta.notes ?? '');
  const [json, setJson] = useState(existing ? JSON.stringify(existing.recipe, null, 2) : '');
  const [saving, setSaving] = useState(false);

  const tpl = TEMPLATE_MAP[templateId];

  // bij wisselen van sjabloon: standaardwaarden overnemen, maten behouden waar zinvol
  const chooseTemplate = (id: string) => {
    setTemplateId(id);
    setParams({ ...TEMPLATE_MAP[id].defaults });
    if (!existing) setCategory(TEMPLATE_MAP[id].category);
  };

  const recipeResult = useMemo((): { recipe: Recipe | null; error: string | null } => {
    try {
      if (mode === 'sjabloon') return { recipe: tpl.build(params), error: null };
      if (!json.trim()) return { recipe: null, error: 'Plak een recept (JSON).' };
      const obj = JSON.parse(extractJson(json));
      // ook een volledig item ({ name, recipe, ... }) mag geplakt worden
      const parsed = RecipeSchema.safeParse(obj && typeof obj === 'object' && 'recipe' in obj ? obj.recipe : obj);
      if (!parsed.success) return { recipe: null, error: parsed.error.issues.slice(0, 4).map((i) => `${i.path.join('.')}: ${i.message}`).join('\n') };
      return { recipe: parsed.data, error: null };
    } catch (e) {
      return { recipe: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [mode, tpl, params, json]);

  const [preview, setPreview] = useState('');
  useEffect(() => {
    if (mode === 'model' || !recipeResult.recipe) return;
    const r = recipeResult.recipe;
    const t = setTimeout(() => setPreview(recipeThumbnail(`preview-${++previewCounter}`, r)), 60);
    return () => clearTimeout(t);
  }, [mode, recipeResult.recipe]);

  // maten van het model na schaal en draaiing
  const modelSize = useMemo(() => {
    const raw = fileInfo
      ? fileInfo.size.toArray()
      : existing?.model
        ? existing.model.bounds.max.map((v, i) => v - existing.model!.bounds.min[i])
        : null;
    if (!raw) return null;
    const quarter = Math.round((((rotation % 360) + 360) % 360) / 90) % 2 === 1;
    const [x, y, z] = raw.map((v) => v * scale);
    return { width: quarter ? z : x, depth: quarter ? x : z, height: y };
  }, [fileInfo, existing, scale, rotation]);

  useEffect(() => {
    if (mode !== 'model' || !modelSize) return;
    let live = true;
    if (fileInfo) {
      const inner = fileInfo.object;
      inner.scale.setScalar(scale);
      inner.rotation.y = (rotation * Math.PI) / 180;
      inner.position.set(0, 0, 0);
      const wrap = new THREE.Group();
      wrap.add(inner);
      wrap.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(inner);
      inner.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
      setPreview(objectThumbnail(wrap, modelSize));
      wrap.remove(inner);
    } else if (existing?.model) {
      modelThumbnail({ ...existing.model, scale, rotation }, modelSize)
        .then((u) => live && setPreview(u))
        .catch(() => undefined);
    }
    return () => {
      live = false;
    };
  }, [mode, fileInfo, existing, scale, rotation, modelSize]);

  const chooseFile = async (f: File | null) => {
    setFile(f);
    setFileInfo(null);
    setFileError(null);
    if (!f) return;
    try {
      const info = await loadFileObject(f);
      setFileInfo(info);
      setScale(guessScale(Math.max(info.size.x, info.size.y, info.size.z)));
      setRotation(0);
      if (!name.trim()) setName(f.name.replace(/\.glb$/i, ''));
    } catch (e) {
      setFileError(`Kon het model niet lezen: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const setNum = (key: string, cm: string, isCm = true) => {
    const v = parseFloat(cm.replace(',', '.'));
    if (!Number.isFinite(v)) return;
    setParams((p) => ({ ...p, [key]: isCm ? v / 100 : v }));
  };

  const canSave = !!name.trim() && !saving && (mode === 'model' ? !!(fileInfo || existing?.model) : !!recipeResult.recipe);

  const save = async () => {
    if (!canSave) return;
    const recipe = recipeResult.recipe;
    setSaving(true);
    if (mode === 'model') {
      const meta = { status, price: price.trim() ? Number(price.replace(',', '.')) : null, shop: shop.trim() || null, url: url.trim() || null, notes: notes.trim() || null, template: null };
      const res = await attempt(async () => {
        let it = existing;
        if (file) it = existing ? await api.replaceModel(existing.id, file) : await api.uploadModel(file, name.trim(), category);
        if (!it) throw new Error('Kies een GLB-bestand.');
        if (it.model && (it.model.scale !== scale || it.model.rotation !== rotation)) it = await api.modelSettings(it.id, { scale, rotation });
        return api.updateItem(it.id, { name: name.trim(), category, meta });
      });
      setSaving(false);
      if (res) {
        useApp.getState().upsertItem(res);
        setPanel('library');
      }
      return;
    }
    if (!recipe) return;
    const meta = {
      status,
      price: price.trim() ? Number(price.replace(',', '.')) : null,
      shop: shop.trim() || null,
      url: url.trim() || null,
      notes: notes.trim() || null,
      template: mode === 'sjabloon' ? { id: templateId, params: params as Record<string, number | string | boolean> } : null,
    };
    const input = { name: name.trim(), category, recipe, meta };
    const res = await attempt(() => (existing ? api.updateItem(existing.id, input) : api.createItem(input)));
    setSaving(false);
    if (res) {
      useApp.getState().upsertItem(res);
      setPanel('library');
    }
  };

  const cmField = (key: string, label: string) => (
    <label className="field">
      <span>{label}</span>
      <div className="unit">
        <input
          inputMode="decimal"
          defaultValue={Math.round(Number(params[key]) * 1000) / 10}
          key={`${templateId}-${key}`}
          onChange={(e) => setNum(key, e.target.value)}
        />
        <em>cm</em>
      </div>
    </label>
  );

  return (
    <aside className="panel editor glass">
      <div className="panel-head">
        <h2>{existing ? 'Meubel bewerken' : 'Nieuw meubel'}</h2>
        <button className="ghost close" onClick={() => setPanel('library')} aria-label="Terug">
          <Icon name="close" />
        </button>
      </div>
      <div className="editor-body">
        <div className="preview">{preview ? <img src={preview} alt="Voorvertoning" /> : <div className="muted">Voorvertoning</div>}</div>
        {mode === 'model' && modelSize && (
          <div className="muted center small-text">
            {Math.round(modelSize.width * 100)} × {Math.round(modelSize.depth * 100)} × {Math.round(modelSize.height * 100)} cm (b × d × h)
          </div>
        )}
        {mode !== 'model' && recipeResult.recipe && (
          <div className="muted center small-text">
            {Math.round(recipeResult.recipe.size.width * 100)} × {Math.round(recipeResult.recipe.size.depth * 100)} × {Math.round(recipeResult.recipe.size.height * 100)} cm (b × d × h)
          </div>
        )}

        <div className="seg wide">
          <button className={mode === 'sjabloon' ? 'on' : ''} onClick={() => setMode('sjabloon')}>
            Sjabloon
          </button>
          <button
            className={mode === 'recept' ? 'on' : ''}
            onClick={() => {
              if (!json && recipeResult.recipe) setJson(JSON.stringify(recipeResult.recipe, null, 2));
              setMode('recept');
            }}
          >
            Recept (JSON)
          </button>
          <button className={mode === 'model' ? 'on' : ''} onClick={() => setMode('model')}>
            3D-model
          </button>
        </div>

        <label className="field">
          <span>Naam</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="bijv. IKEA Söderhamn 3-zits" />
        </label>

        {mode === 'model' ? (
          <>
            {existing?.model && !file && (
              <div className="model-info">
                <strong>{existing.model.source === 'blender' ? 'Gemaakt in Blender' : 'Geüpload model'}</strong>
                <span className="muted">
                  {existing.model.triangles.toLocaleString('nl-NL')} driehoeken · {Math.round(existing.model.bytes / 1024).toLocaleString('nl-NL')} kB
                </span>
              </div>
            )}
            <label className="file-drop">
              <input type="file" accept=".glb,model/gltf-binary" onChange={(e) => chooseFile(e.target.files?.[0] ?? null)} />
              {file ? `${file.name} (${fileInfo ? `${fileInfo.triangles.toLocaleString('nl-NL')} driehoeken` : 'laden…'})` : existing?.model ? 'Ander GLB-bestand kiezen…' : 'Kies een GLB-bestand (export uit Blender, SketchUp, IKEA, …)'}
            </label>
            {fileError && <pre className="error-box">{fileError}</pre>}
            {(fileInfo || existing?.model) && (
              <div className="grid2">
                <label className="field">
                  <span>Eenheid van het model</span>
                  <select value={scale} onChange={(e) => setScale(Number(e.target.value))}>
                    {SCALES.map((o) => (
                      <option key={o.v} value={o.v}>
                        {o.label}
                      </option>
                    ))}
                    {!SCALES.some((o) => o.v === scale) && <option value={scale}>schaal {scale}</option>}
                  </select>
                </label>
                <label className="field">
                  <span>Voorkant draaien</span>
                  <select value={rotation} onChange={(e) => setRotation(Number(e.target.value))}>
                    {[0, 90, 180, 270].map((d) => (
                      <option key={d} value={d}>
                        {d}°
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
            <p className="muted small-text">De voorkant hoort naar je toe te wijzen in de voorvertoning. Claude kan modellen ook rechtstreeks maken met Blender.</p>
          </>
        ) : mode === 'sjabloon' ? (
          <>
            <label className="field">
              <span>Soort</span>
              <select value={templateId} onChange={(e) => chooseTemplate(e.target.value)}>
                {TEMPLATES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid3">
              {cmField('width', 'Breedte')}
              {cmField('depth', 'Diepte')}
              {cmField('height', 'Hoogte')}
            </div>
            <div className="grid2">
              <label className="field">
                <span>{tpl.colorLabel ?? 'Kleur'}</span>
                <input type="color" value={params.color} onChange={(e) => setParams((p) => ({ ...p, color: e.target.value }))} />
              </label>
              {tpl.accentLabel && (
                <label className="field">
                  <span>{tpl.accentLabel}</span>
                  <input type="color" value={params.accent} onChange={(e) => setParams((p) => ({ ...p, accent: e.target.value }))} />
                </label>
              )}
            </div>
            {tpl.extra?.map((x) =>
              x.kind === 'boolean' ? (
                <label key={x.key} className="check">
                  <input type="checkbox" checked={Boolean(params[x.key])} onChange={(e) => setParams((p) => ({ ...p, [x.key]: e.target.checked }))} />
                  {x.label}
                </label>
              ) : x.kind === 'select' ? (
                <label key={x.key} className="field">
                  <span>{x.label}</span>
                  <select value={String(params[x.key])} onChange={(e) => setParams((p) => ({ ...p, [x.key]: e.target.value }))}>
                    {x.options!.map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                </label>
              ) : (x.step ?? 1) < 1 ? (
                <div key={x.key}>{cmField(x.key, x.label)}</div>
              ) : (
                <label key={x.key} className="field">
                  <span>{x.label}</span>
                  <input
                    inputMode="numeric"
                    defaultValue={Number(params[x.key])}
                    key={`${templateId}-${x.key}`}
                    onChange={(e) => setNum(x.key, e.target.value, false)}
                  />
                </label>
              ),
            )}
          </>
        ) : (
          <label className="field">
            <span>Recept — plak hier het JSON-recept uit een Claude-gesprek</span>
            <textarea className="code" rows={12} value={json} onChange={(e) => setJson(e.target.value)} spellCheck={false} />
          </label>
        )}
        {mode !== 'model' && recipeResult.error && <pre className="error-box">{recipeResult.error}</pre>}

        <div className="grid2">
          <label className="field">
            <span>Categorie</span>
            <select value={category} onChange={(e) => setCategory(e.target.value as Category)}>
              {CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value as ItemStatus)}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="grid2">
          <label className="field">
            <span>Prijs (€)</span>
            <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
          </label>
          <label className="field">
            <span>Winkel</span>
            <input value={shop} onChange={(e) => setShop(e.target.value)} />
          </label>
        </div>
        <label className="field">
          <span>Link</span>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
        </label>
        <label className="field">
          <span>Notities</span>
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </div>
      <div className="panel-foot">
        <button onClick={() => setPanel('library')}>Annuleren</button>
        <button className="primary" disabled={!canSave} onClick={save}>
          {saving ? 'Opslaan…' : 'Opslaan'}
        </button>
      </div>
    </aside>
  );
}

/** haal JSON uit een stuk tekst (bijv. met ```json-blokken eromheen) */
function extractJson(text: string): string {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) return fence[1];
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
}
