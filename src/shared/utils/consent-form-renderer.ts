/**
 * Consent Form Renderer
 *
 * Renders consent-form placeholders into a patient-specific snapshot.
 * - Replaces {key} and {{key}} in element strings (label/placeholder).
 * - Replaces placeholders inside DraftJS RawContentState for textbox elements.
 * - Normalizes DOCTOR_NAME DraftJS entities to display as "Dr. FName LName".
 *
 * NOTE: This module intentionally avoids logging PHI.
 */

import { getClinicConfig, type ClinicConfig } from './secrets-helper';
import { makeOpenDentalRequest } from './opendental-api';
import { renderTemplate } from './clinic-placeholders';

const API_BASE = '/api/v1';
const DOCTOR_ENTITY_TYPE = 'DOCTOR_NAME';

type DraftInlineStyleRange = { offset: number; length: number; style: string };
type DraftEntityRange = { offset: number; length: number; key: number };
type DraftBlock = {
  key: string;
  text: string;
  type: string;
  depth: number;
  inlineStyleRanges?: DraftInlineStyleRange[];
  entityRanges?: DraftEntityRange[];
  data?: any;
};
type DraftEntity = { type: string; mutability: string; data?: any };
type DraftRawContent = { blocks: DraftBlock[]; entityMap: Record<string, DraftEntity> };

export type ConsentFormRenderSnapshots = {
  clinic: {
    clinicId: string;
    clinicName?: string;
    websiteLink?: string;
    clinicPhone?: string;
    clinicEmail?: string;
    timezone?: string;
  };
  patient: {
    PatNum: number;
    FName?: string;
    LName?: string;
    Birthdate?: string;
    Email?: string;
    WirelessPhone?: string;
    HmPhone?: string;
    WkPhone?: string;
    ChartNumber?: string;
  };
};

export type ConsentFormRenderResult = {
  renderedElements: any[];
  context: Record<string, string>;
  snapshots: ConsentFormRenderSnapshots;
};

function toFiniteNumber(value: any): number | null {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  if (!Number.isFinite(n)) return null;
  return n;
}

function safeTrim(value: any): string {
  return String(value ?? '').trim();
}

function firstNonEmpty(values: any[]): string {
  for (const v of values) {
    const s = safeTrim(v);
    if (s) return s;
  }
  return '';
}

function parseOpenDentalDateTime(value: any): Date | null {
  const raw = safeTrim(value);
  if (!raw) return null;
  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');
  const d1 = new Date(normalized);
  if (!Number.isNaN(d1.getTime())) return d1;
  const d2 = new Date(`${normalized}Z`);
  if (!Number.isNaN(d2.getTime())) return d2;
  return null;
}

function formatDateMMDDYYYY(date: Date | null, timezone?: string): string {
  if (!date) return '';
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timezone || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  } catch {
    // Fallback without timezone
    return date.toISOString().split('T')[0];
  }
}

function formatCurrency(value: any): string {
  const n = toFiniteNumber(value);
  if (n === null) return '';
  return `$${n.toFixed(2)}`;
}

function formatDoctorFromProvider(provider: any): string {
  const first = safeTrim(provider?.FName);
  const last = safeTrim(provider?.LName);
  const full = [first, last].filter(Boolean).join(' ').trim();
  if (full) return `Dr. ${full}`;
  const abbr = safeTrim(provider?.Abbr);
  if (abbr) return `Dr. ${abbr}`;
  return 'Dr.';
}

function formatDoctorFromEntityData(entityData: any): string {
  const first = safeTrim(entityData?.fName || entityData?.FName);
  const last = safeTrim(entityData?.lName || entityData?.LName);
  const full = [first, last].filter(Boolean).join(' ').trim();
  if (full) return `Dr. ${full}`;
  const abbr = safeTrim(entityData?.abbr || entityData?.Abbr);
  if (abbr) return `Dr. ${abbr}`;
  return 'Dr.';
}

function looksLikeDraftRawContent(input: any): input is DraftRawContent {
  return (
    input &&
    typeof input === 'object' &&
    Array.isArray(input.blocks) &&
    input.entityMap &&
    typeof input.entityMap === 'object'
  );
}

function normalizeDraftRawContent(input: any): DraftRawContent | null {
  if (!input) return null;
  if (looksLikeDraftRawContent(input)) return input;
  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input);
      return looksLikeDraftRawContent(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

function getPlaceholderKeyFromMatch(m: RegExpExecArray): string {
  const key = (m[1] || m[2] || '').trim();
  return key;
}

function transformRangesForReplacement<T extends { offset: number; length: number }>(
  ranges: T[],
  start: number,
  end: number,
  oldLen: number,
  newLen: number
): T[] {
  const delta = newLen - oldLen;
  return ranges.map((r) => {
    const rStart = r.offset;
    const rEnd = r.offset + r.length;

    // Completely before replacement
    if (rEnd <= start) return { ...r };
    // Completely after replacement
    if (rStart >= end) return { ...r, offset: r.offset + delta };

    // Overlaps replacement region. We treat the replacement as atomic and keep the range covering
    // the new replacement text (best-effort preservation).
    const newStart = rStart < start ? rStart : start;
    const newEnd = rEnd <= end ? start + newLen : rEnd + delta;
    const nextLen = Math.max(0, newEnd - newStart);
    return { ...r, offset: newStart, length: nextLen };
  });
}

type Replacement = { start: number; end: number; text: string; priority: number };

function applyReplacementsToBlock(block: DraftBlock, replacements: Replacement[]): DraftBlock {
  if (replacements.length === 0) return block;

  const origText = String(block.text || '');
  let newText = '';
  let cursor = 0;
  let cumulativeDelta = 0;

  let inlineStyleRanges = Array.isArray(block.inlineStyleRanges)
    ? block.inlineStyleRanges.map((r) => ({ ...r }))
    : [];
  let entityRanges = Array.isArray(block.entityRanges)
    ? block.entityRanges.map((r) => ({ ...r }))
    : [];

  for (const rep of replacements) {
    // Build new text from original coordinates
    newText += origText.slice(cursor, rep.start) + rep.text;
    cursor = rep.end;

    // Transform ranges in *current* coordinates (shifted by previous deltas)
    const startNow = rep.start + cumulativeDelta;
    const endNow = rep.end + cumulativeDelta;
    const oldLen = endNow - startNow;
    const newLen = rep.text.length;

    inlineStyleRanges = transformRangesForReplacement(inlineStyleRanges, startNow, endNow, oldLen, newLen);
    entityRanges = transformRangesForReplacement(entityRanges, startNow, endNow, oldLen, newLen);

    cumulativeDelta += newLen - oldLen;
  }

  newText += origText.slice(cursor);

  return {
    ...block,
    text: newText,
    inlineStyleRanges,
    entityRanges,
  };
}

function renderDraftRawContent(args: {
  raw: DraftRawContent;
  clinicId: string;
  context: Record<string, string>;
  providersByProvNum: Record<string, any>;
  fallbackDoctorName: string;
}): DraftRawContent {
  const { raw, clinicId, context, providersByProvNum, fallbackDoctorName } = args;
  const cid = safeTrim(clinicId);

  const entityMap: Record<string, DraftEntity> = {};
  for (const [k, v] of Object.entries(raw.entityMap || {})) {
    entityMap[k] = { ...v, data: v?.data ? { ...(v.data as any) } : undefined };
  }

  const blocks = (raw.blocks || []).map((b) => {
    const block: DraftBlock = {
      ...b,
      text: String(b.text || ''),
      inlineStyleRanges: Array.isArray(b.inlineStyleRanges) ? b.inlineStyleRanges.map((r) => ({ ...r })) : [],
      entityRanges: Array.isArray(b.entityRanges) ? b.entityRanges.map((r) => ({ ...r })) : [],
    };

    const protectedRanges = (block.entityRanges || []).map((r) => ({
      start: r.offset,
      end: r.offset + r.length,
      key: r.key,
    }));

    const replacements: Replacement[] = [];

    // 1) Normalize DOCTOR_NAME entities to "Dr. FName LName"
    for (const r of protectedRanges) {
      const entKey = String(r.key);
      const ent = entityMap[entKey];
      if (!ent || ent.type !== DOCTOR_ENTITY_TYPE) continue;

      const perClinic = cid ? (ent.data as any)?.providersByClinicId?.[cid] : undefined;
      const provNum =
        safeTrim((perClinic as any)?.provNum ?? (perClinic as any)?.ProvNum) ||
        safeTrim(ent.data?.provNum);
      const provider = provNum ? providersByProvNum[provNum] : undefined;
      const display = provider
        ? formatDoctorFromProvider(provider)
        : perClinic
          ? formatDoctorFromEntityData(perClinic)
          : formatDoctorFromEntityData(ent.data);

      replacements.push({
        start: r.start,
        end: r.end,
        text: display,
        priority: 2, // higher than plain placeholders
      });
    }

    // 2) Replace {key} / {{key}} placeholders in block text (skip anything inside entity ranges)
    const re = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}|\{([a-zA-Z0-9_]+)\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(block.text)) !== null) {
      const key = getPlaceholderKeyFromMatch(m);
      if (!key) continue;

      const value =
        key === 'doctorName'
          ? fallbackDoctorName
          : Object.prototype.hasOwnProperty.call(context, key)
            ? context[key]
            : undefined;
      if (value === undefined) continue;

      const start = m.index;
      const end = start + m[0].length;
      const overlapsEntity = protectedRanges.some((r) => start < r.end && end > r.start);
      if (overlapsEntity) continue;

      replacements.push({ start, end, text: String(value), priority: 1 });
    }

    if (replacements.length === 0) return block;

    // Sort by start, then priority (desc), then longest match first
    const sorted = replacements
      .slice()
      .sort((a, b) => (a.start - b.start) || (b.priority - a.priority) || ((b.end - b.start) - (a.end - a.start)));

    // Drop overlaps (keep earlier/higher-priority replacement)
    const picked: Replacement[] = [];
    let lastEnd = -1;
    for (const rep of sorted) {
      if (rep.start < lastEnd) continue;
      picked.push(rep);
      lastEnd = rep.end;
    }

    return applyReplacementsToBlock(block, picked);
  });

  return {
    blocks,
    entityMap,
  };
}

async function fetchOpenDentalGet(clinicId: string, path: string): Promise<any> {
  return await makeOpenDentalRequest('GET', path, clinicId);
}

async function fetchPatient(clinicId: string, patNum: number): Promise<any | null> {
  try {
    return await fetchOpenDentalGet(clinicId, `${API_BASE}/patients/${patNum}`);
  } catch {
    return null;
  }
}

async function fetchAging(clinicId: string, patNum: number): Promise<any | null> {
  try {
    return await fetchOpenDentalGet(clinicId, `${API_BASE}/accountmodules/${patNum}/Aging`);
  } catch {
    return null;
  }
}

async function fetchFamilyInsurance(clinicId: string, patNum: number): Promise<any[] | null> {
  try {
    const resp = await fetchOpenDentalGet(clinicId, `${API_BASE}/familymodules/${patNum}/Insurance`);
    const arr = Array.isArray(resp) ? resp : Array.isArray((resp as any)?.items) ? (resp as any).items : null;
    return Array.isArray(arr) ? arr : null;
  } catch {
    return null;
  }
}

async function fetchAppointments(clinicId: string, patNum: number): Promise<any[] | null> {
  try {
    const resp = await fetchOpenDentalGet(clinicId, `${API_BASE}/appointments?PatNum=${encodeURIComponent(String(patNum))}`);
    const arr = Array.isArray(resp) ? resp : Array.isArray((resp as any)?.items) ? (resp as any).items : null;
    return Array.isArray(arr) ? arr : null;
  } catch {
    return null;
  }
}

async function fetchProvider(clinicId: string, provNum: string): Promise<any | null> {
  const pn = safeTrim(provNum);
  if (!pn) return null;
  try {
    return await fetchOpenDentalGet(clinicId, `${API_BASE}/providers/${encodeURIComponent(pn)}`);
  } catch {
    return null;
  }
}

function extractPrimaryInsurance(records: any[] | null): { primaryInsName: string; subscriberName: string } {
  if (!Array.isArray(records) || records.length === 0) return { primaryInsName: '', subscriberName: '' };

  const pick =
    records.find((r) => String(r?.IsPrimary ?? '').toLowerCase() === 'true') ||
    records.find((r) => Number(r?.Ordinal) === 1 || Number(r?.ordinal) === 1) ||
    records[0];

  const primaryInsName = firstNonEmpty([
    pick?.CarrierName,
    pick?.carrierName,
    pick?.InsuranceName,
    pick?.insuranceName,
    pick?.Carrier,
    pick?.carrier,
    pick?.PlanName,
    pick?.planName,
    pick?.GroupName,
    pick?.groupName,
  ]);

  const subscriberName = firstNonEmpty([
    pick?.SubscriberName,
    pick?.subscriberName,
    pick?.Subscriber,
    pick?.subscriber,
    pick?.SubscriberID,
    pick?.subscriberId,
    pick?.SubscriberId,
    // Some payloads may have separate name fields
    [pick?.SubscriberFName, pick?.SubscriberLName].filter(Boolean).join(' '),
    [pick?.subscriberFName, pick?.subscriberLName].filter(Boolean).join(' '),
  ]);

  return { primaryInsName, subscriberName };
}

function pickNextAppointmentDate(appointments: any[] | null): Date | null {
  if (!Array.isArray(appointments) || appointments.length === 0) return null;
  const now = Date.now();
  let best: Date | null = null;
  for (const a of appointments) {
    const d = parseOpenDentalDateTime(a?.AptDateTime || a?.aptDateTime || a?.DateTime || a?.dateTime);
    if (!d) continue;
    const t = d.getTime();
    if (t < now - 5 * 60 * 1000) continue; // ignore clearly past (5 min grace)
    if (!best || t < best.getTime()) best = d;
  }
  return best;
}

function extractAppointmentProvNum(appointments: any[] | null): string {
  if (!Array.isArray(appointments) || appointments.length === 0) return '';
  const next = pickNextAppointmentDate(appointments);
  if (!next) return '';

  // Find the appointment object that matched the next date
  const nextTs = next.getTime();
  const apt = appointments.find((a) => {
    const d = parseOpenDentalDateTime(a?.AptDateTime || a?.aptDateTime || a?.DateTime || a?.dateTime);
    return d && d.getTime() === nextTs;
  });
  return safeTrim(apt?.ProvNum || apt?.provNum || apt?.ProviderNum || apt?.providerNum);
}

function extractDoctorProvNumsFromElements(elements: any[], clinicId?: string): string[] {
  const cid = safeTrim(clinicId);
  const out = new Set<string>();
  for (const el of elements || []) {
    const raw = normalizeDraftRawContent((el as any)?.content);
    if (!raw) continue;
    for (const ent of Object.values(raw.entityMap || {})) {
      if (String(ent?.type || '') !== DOCTOR_ENTITY_TYPE) continue;
      const data = (ent as any)?.data;
      const perClinic = cid ? data?.providersByClinicId?.[cid] : undefined;
      const provNum =
        safeTrim(perClinic?.provNum ?? perClinic?.ProvNum) ||
        safeTrim(data?.provNum);
      if (provNum) out.add(provNum);
    }
  }
  return Array.from(out);
}

function buildSnapshots(clinicId: string, clinic: ClinicConfig | null, patNum: number, patient: any | null): ConsentFormRenderSnapshots {
  return {
    clinic: {
      clinicId,
      clinicName: clinic?.clinicName || undefined,
      websiteLink: clinic?.websiteLink || undefined,
      clinicPhone: clinic?.clinicPhone || clinic?.phoneNumber || undefined,
      clinicEmail: clinic?.clinicEmail || undefined,
      timezone: clinic?.timezone || undefined,
    },
    patient: {
      PatNum: patNum,
      FName: safeTrim(patient?.FName) || undefined,
      LName: safeTrim(patient?.LName) || undefined,
      Birthdate: safeTrim(patient?.Birthdate) || undefined,
      Email: safeTrim(patient?.Email) || undefined,
      WirelessPhone: safeTrim(patient?.WirelessPhone) || undefined,
      HmPhone: safeTrim(patient?.HmPhone) || undefined,
      WkPhone: safeTrim(patient?.WkPhone) || undefined,
      ChartNumber: safeTrim(patient?.ChartNumber) || undefined,
    },
  };
}

function buildContext(args: {
  clinic: ClinicConfig | null;
  patient: any | null;
  aging: any | null;
  insurance: any[] | null;
  appointmentDate: Date | null;
  doctorName: string;
  now: Date;
}): Record<string, string> {
  const { clinic, patient, aging, insurance, appointmentDate, doctorName, now } = args;
  const tz = clinic?.timezone || undefined;

  const first = safeTrim(patient?.FName);
  const last = safeTrim(patient?.LName);
  const full = [first, last].filter(Boolean).join(' ').trim();

  const { primaryInsName, subscriberName } = extractPrimaryInsurance(insurance);

  return {
    clinicName: safeTrim(clinic?.clinicName),
    todayDate: formatDateMMDDYYYY(now, tz),
    appointmentDate: formatDateMMDDYYYY(appointmentDate, tz),
    patientFirstname: first,
    patientLastname: last,
    patientFullName: full,
    chartNumber: safeTrim(patient?.ChartNumber),
    amountDue: formatCurrency(aging?.PatEstBal ?? aging?.patEstBal),
    balance: formatCurrency(aging?.EstBal ?? aging?.estBal ?? aging?.Total ?? aging?.total),
    primaryInsName,
    subscriberName,
    doctorName,
  };
}

function renderStringTemplate(value: any, context: Record<string, string>): any {
  if (typeof value !== 'string') return value;
  return renderTemplate(value, context);
}

function renderElementsWithContext(args: {
  clinicId: string;
  elements: any[];
  context: Record<string, string>;
  providersByProvNum: Record<string, any>;
  fallbackDoctorName: string;
}): any[] {
  const { clinicId, elements, context, providersByProvNum, fallbackDoctorName } = args;

  const out: any[] = [];

  for (const el of elements || []) {
    const next: any = { ...(el as any) };

    // Render simple string properties
    next.label = renderStringTemplate(next.label, context);
    next.placeholder = renderStringTemplate(next.placeholder, context);

    // Textbox DraftJS raw content
    if (String(next.type || '').toLowerCase() === 'textbox') {
      const raw = normalizeDraftRawContent(next.content);
      if (raw) {
        const renderedRaw = renderDraftRawContent({
          raw,
          clinicId,
          context,
          providersByProvNum,
          fallbackDoctorName,
        });
        next.content = renderedRaw;
      } else {
        // Fallback: if it’s plain text (unexpected), still template-render it
        next.content = renderStringTemplate(next.content, context);
      }
    }

    out.push(next);
  }

  return out;
}

export async function renderConsentFormElements(args: {
  clinicId: string;
  patNum: number;
  elements: any[];
  clinicConfig?: ClinicConfig | null;
  patient?: any | null;
}): Promise<ConsentFormRenderResult> {
  const clinicId = safeTrim(args.clinicId);
  const patNum = Number(args.patNum);
  const elements = Array.isArray(args.elements) ? args.elements : [];

  const [clinicConfig, patient, aging, insurance, appointments] = await Promise.all([
    args.clinicConfig !== undefined ? args.clinicConfig : getClinicConfig(clinicId),
    args.patient !== undefined ? args.patient : fetchPatient(clinicId, patNum),
    fetchAging(clinicId, patNum),
    fetchFamilyInsurance(clinicId, patNum),
    fetchAppointments(clinicId, patNum),
  ]);

  const appointmentDate = pickNextAppointmentDate(appointments);
  const appointmentProvNum = extractAppointmentProvNum(appointments);

  // Provider lookups needed for DOCTOR_NAME entities + fallback doctorName
  const provNums = new Set<string>(extractDoctorProvNumsFromElements(elements, clinicId));
  if (appointmentProvNum) provNums.add(appointmentProvNum);

  const providersByProvNum: Record<string, any> = {};
  await Promise.all(Array.from(provNums).map(async (pn) => {
    const p = await fetchProvider(clinicId, pn);
    if (p) providersByProvNum[pn] = p;
  }));

  const fallbackDoctorName = appointmentProvNum && providersByProvNum[appointmentProvNum]
    ? formatDoctorFromProvider(providersByProvNum[appointmentProvNum])
    : '';

  const now = new Date();
  const context = buildContext({
    clinic: clinicConfig,
    patient,
    aging,
    insurance,
    appointmentDate,
    doctorName: fallbackDoctorName,
    now,
  });

  const renderedElements = renderElementsWithContext({
    clinicId,
    elements,
    context,
    providersByProvNum,
    fallbackDoctorName,
  });

  return {
    renderedElements,
    context,
    snapshots: buildSnapshots(clinicId, clinicConfig, patNum, patient),
  };
}

