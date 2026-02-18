/**
 * Regen Ledger REST API client
 *
 * Queries credit classes, projects, batches, and sell orders
 * from the Regen Network blockchain.
 */

const REGEN_LCD_URL =
  process.env.REGEN_LCD_URL || "https://regen.api.m.stavr.tech";

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
  return data.classes;
}

export async function listProjects(classId?: string): Promise<Project[]> {
  const path = classId
    ? `/regen/ecocredit/v1/projects-by-class/${classId}`
    : "/regen/ecocredit/v1/projects";
  const data = await fetchJSON<{ projects: Project[] }>(path);
  return data.projects;
}

export async function listBatches(projectId?: string): Promise<CreditBatch[]> {
  const path = projectId
    ? `/regen/ecocredit/v1/batches-by-project/${projectId}`
    : "/regen/ecocredit/v1/batches";
  const data = await fetchJSON<{ batches: CreditBatch[] }>(path);
  return data.batches;
}

export async function listSellOrders(): Promise<SellOrder[]> {
  const data = await fetchJSON<{ sell_orders: SellOrder[] }>(
    "/regen/ecocredit/marketplace/v1/sell-orders"
  );
  return data.sell_orders;
}
