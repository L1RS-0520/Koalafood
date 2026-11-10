import type { RecipeDraft } from "./generator/draft.ts";

export type ChefStatus = "pending" | "draft" | "confirmed";
export interface DishRow {
  id: string; name: string; category: string; note: string | null;
  ingredients: string; steps: string; tips: string;
  servings: string | null; total_time: string | null;
  source: "chef" | "manual"; chef_status: ChefStatus;
  draft: string | null; requested_note: string | null;
  chef_requested_at: string | null; claimed_at: string | null; draft_at: string | null;
  created_at: string; updated_at: string;
}
export interface PhotoRow { id: string; dish_id: string; r2_key: string; content_type: string; position: number; created_at: string }

const parseJson = <T>(s: string | null, dflt: T): T => { if (!s) return dflt; try { return JSON.parse(s) as T; } catch { return dflt; } };
const parseArr = (s: string) => { const v = parseJson<unknown>(s, []); return Array.isArray(v) ? v : []; };
export const photoUrl = (key: string) => `/api/photos/${key}`;
const photoList = (ps: PhotoRow[]) => ps.map((p) => ({ id: p.id, url: photoUrl(p.r2_key) }));

export function toDish(r: DishRow, photos: PhotoRow[]) {
  const list = photoList(photos);
  return {
    id: r.id, name: r.name, category: r.category, note: r.note,
    photo_url: list[0]?.url ?? null, photos: list,
    ingredients: parseArr(r.ingredients), steps: parseArr(r.steps), tips: parseArr(r.tips),
    servings: r.servings, total_time: r.total_time,
    source: r.source, chef_status: r.chef_status,
    draft: r.chef_status === "draft" ? parseJson<RecipeDraft | null>(r.draft, null) : null,
    requested_note: r.requested_note, chef_requested_at: r.chef_requested_at,
    created_at: r.created_at, updated_at: r.updated_at,
  };
}

export function toTask(r: DishRow, photos: PhotoRow[]) {
  return {
    id: r.id, name: r.name, category: r.category, note: r.note, requested_note: r.requested_note,
    photos: photos.map((p) => ({ id: p.id, url: `/api/chef/tasks/${r.id}/photos/${p.id}` })),
    requested_at: r.chef_requested_at, claimed_at: r.claimed_at,
  };
}

export const draftColumns = (d: RecipeDraft) => ({
  ingredients: JSON.stringify(d.ingredients), steps: JSON.stringify(d.steps), tips: JSON.stringify(d.tips),
  servings: d.servings, total_time: d.total_time,
});

export const getDish = (db: D1Database, id: string) =>
  db.prepare("SELECT * FROM dishes WHERE id = ?").bind(id).first<DishRow>();

export async function getPhotos(db: D1Database, dishId: string): Promise<PhotoRow[]> {
  const r = await db.prepare("SELECT * FROM dish_photos WHERE dish_id = ? ORDER BY position, created_at").bind(dishId).all<PhotoRow>();
  return r.results;
}

export async function getChefEnabled(db: D1Database): Promise<boolean> {
  const r = await db.prepare("SELECT value FROM settings WHERE key = 'chef_enabled'").first<{ value: string }>();
  return r ? r.value !== "false" : true;
}
