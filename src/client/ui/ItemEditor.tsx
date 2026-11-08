import { useEffect, useMemo, useState } from 'react';
import { CATEGORIES, RecipeSchema, STATUSES, STATUS_LABELS, type Category, type ItemStatus, type Recipe } from '../../shared/recipe';
import { TEMPLATES, TEMPLATE_MAP, type TemplateParams } from '../../shared/templates';
import { api } from '../api';
import { attempt, useApp } from '../store';
import { recipeThumbnail } from '../three/thumbnail';

let previewCounter = 0;

type Mode = 'sjabloon' | 'recept';

export function ItemEditor() {
  const editingId = useApp((s) => s.editingItemId);
  const items = useApp((s) => s.items);
  const setPanel = useApp((s) => s.setPanel);
  const existing = items.find((i) => i.id === editingId) ?? null;

  const initialTemplate = existing?.meta.template?.id ?? (existing ? null : 'bank');
  const [mode, setMode] = useState<Mode>(existing && !existing.meta.template ? 'recept' : 'sjabloon');
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
    if (!recipeResult.recipe) return;
    const r = recipeResult.recipe;
    const t = setTimeout(() => setPreview(recipeThumbnail(`preview-${++previewCounter}`, r)), 60);
    return () => clearTimeout(t);
  }, [recipeResult.recipe]);

  const setNum = (key: string, cm: string, isCm = true) => {
    const v = parseFloat(cm.replace(',', '.'));
    if (!Number.isFinite(v)) return;
    setParams((p) => ({ ...p, [key]: isCm ? v / 100 : v }));
  };

  const save = async () => {
    const recipe = recipeResult.recipe;
    if (!recipe || !name.trim()) return;
    setSaving(true);
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
    <aside className="panel editor">
      <div className="panel-head">
        <h2>{existing ? 'Meubel bewerken' : 'Nieuw meubel'}</h2>
        <button className="ghost close" onClick={() => setPanel('library')} aria-label="Terug">
          ✕
        </button>
      </div>
      <div className="editor-body">
        <div className="preview">{preview ? <img src={preview} alt="Voorvertoning" /> : <div className="muted">Voorvertoning</div>}</div>
        {recipeResult.recipe && (
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
        </div>

        <label className="field">
          <span>Naam</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="bijv. IKEA Söderhamn 3-zits" />
        </label>

        {mode === 'sjabloon' ? (
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
        {recipeResult.error && <pre className="error-box">{recipeResult.error}</pre>}

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
        <button className="primary" disabled={!recipeResult.recipe || !name.trim() || saving} onClick={save}>
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
