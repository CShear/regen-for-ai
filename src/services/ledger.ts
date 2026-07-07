/**
 * Regen Ledger REST API client
 *
 * Queries credit classes, projects, batches, and sell orders
 * from the Regen Network blockchain.
 */

const REGEN_LCD_URL =
  process.env.REGEN_LCD_URL || "https://lcd-regen.keplr.app";

// Credit classes excluded from the regen-compute program (Verra/VCS credits)
const EXCLUDED_CLASS_IDS = new Set(["C01", "C03"]);

export interface CreditClass {
  id: string;
  admin: string;
  metadata: string;
  credit_type_abbrev: string;
}

export interface Project {
  id: string;
  class_id: string;
  jurisdiction: string;
  metadata: string;
  reference_id: string;
}

export interface CreditBatch {
  denom: string;
  project_id: string;
  issuer: string;
  start_date: string;
  end_date: string;
  issuance_date: string;
  metadata: string;
}

export interface SellOrder {
  id: string;
  seller: string;
  batch_denom: string;
  quantity: string;
  ask_denom: string;
  ask_amount: string;
  disable_auto_retire: boolean;
  expiration: string | null;
}

export interface AllowedDenom {
  bank_denom: string;
  display_denom: string;
  exponent: number;
}

async function fetchJSON<T>(path: string): Promise<T> {
  const response = await fetch(`${REGEN_LCD_URL}${path}`);
  if (!response.ok) {
    throw new Error(
      `Regen Ledger API error: ${response.status} ${response.statusText}`
    );
  }
  return response.json() as Promise<T>;
}

export async function listCreditClasses(): Promise<CreditClass[]> {
  const data = await fetchJSON<{ classes: CreditClass[] }>(
    "/regen/ecocredit/v1/classes"
  );
  return data.classes.filter((c) => !EXCLUDED_CLASS_IDS.has(c.id));
}

export async function listProjects(classId?: string): Promise<Project[]> {
  const path = classId
    ? `/regen/ecocredit/v1/projects-by-class/${classId}`
    : "/regen/ecocredit/v1/projects";
  const data = await fetchJSON<{ projects: Project[] }>(path);
  return data.projects.filter((p) => !EXCLUDED_CLASS_IDS.has(p.class_id));
}

export async function listBatches(projectId?: string): Promise<CreditBatch[]> {
  const path = projectId
    ? `/regen/ecocredit/v1/batches-by-project/${projectId}`
    : "/regen/ecocredit/v1/batches";
  const data = await fetchJSON<{ batches: CreditBatch[] }>(path);
  return data.batches.filter((b) => {
    const classId = b.denom.replace(/-\d.*$/, "");
    return !EXCLUDED_CLASS_IDS.has(classId);
  });
}

export async function listSellOrders(): Promise<SellOrder[]> {
  // Paginate: the Cosmos LCD returns a bounded page (~100) by default. Once the
  // marketplace exceeds one page, specific targeted sell orders could silently
  // disappear from the result, causing paid retirements to fail with "order not
  // found". Walk pagination.next_key until exhausted.
  const all: SellOrder[] = [];
  let nextKey: string | undefined;
  let pages = 0;
  do {
    const qs = new URLSearchParams({ "pagination.limit": "1000" });
    if (nextKey) qs.set("pagination.key", nextKey);
    const data = await fetchJSON<{
      sell_orders: SellOrder[];
      pagination?: { next_key: string | null };
    }>(`/regen/ecocredit/marketplace/v1/sell-orders?${qs.toString()}`);
    all.push(...(data.sell_orders ?? []));
    nextKey = data.pagination?.next_key || undefined;
    pages++;
  } while (nextKey && pages < 50); // guard against pathological pagination loops

  return all.filter((o) => {
    const classId = o.batch_denom.replace(/-\d.*$/, "");
    return !EXCLUDED_CLASS_IDS.has(classId);
  });
}

export async function getAllowedDenoms(): Promise<AllowedDenom[]> {
  const data = await fetchJSON<{ allowed_denoms: AllowedDenom[] }>(
    "/regen/ecocredit/marketplace/v1/allowed-denoms"
  );
  return data.allowed_denoms;
}
