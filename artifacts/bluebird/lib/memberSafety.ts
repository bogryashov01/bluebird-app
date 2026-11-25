/**
 * Report and block for the authenticated member session.
 *
 * The block list returns only opaque ids and timestamps. It is not a member
 * directory and must not be used to name who is blocked.
 */

import {
  validateMainBluebirdApiBaseUrl,
  type MainBluebirdApiEnvironment,
} from './mainBluebirdApiConfig';
import { clearMemberConnectionsCache, isMemberConnectionsIntegrationEnabled } from './memberConnections';
import { clearMemberMessagesCache, isMemberMessagesIntegrationEnabled } from './memberMessages';
import {
  ProductionAuthCancelledError,
  ProductionAuthHttpError,
  ProductionAuthInvalidJsonError,
  ProductionAuthNetworkError,
  ProductionAuthRequestError,
  ProductionAuthSchemaError,
  ProductionAuthTimeoutError,
  PRODUCTION_AUTH_TIMEOUT_MS,
} from './productionAuthApi';
import { requestProductionJson } from './productionRequestTransport';

export const MEMBER_REPORT_PATH = '/me/member-reports';
export const MEMBER_BLOCKS_PATH = '/me/connections/blocks';
export const MEMBER_REPORT_DESCRIPTION_MAX = 5000;
export const MEMBER_REPORT_REASONS = [
  'harassment',
  'spam',
  'impersonation',
  'inappropriate_content',
  'safety_concern',
  'other',
] as const;

export type MemberReportReason = (typeof MEMBER_REPORT_REASONS)[number];

export interface MemberSafetyHandoff {
  mode: 'report' | 'block';
  userId: string;
}

/** Keeps the first request while a profile modal is still dismissing. */
export function queueMemberSafetyHandoff(
  current: MemberSafetyHandoff | null,
  requested: MemberSafetyHandoff,
): MemberSafetyHandoff {
  return current ?? requested;
}

/**
 * iOS cannot present the report or block modal until the profile modal, and any
 * modal underneath it, has finished dismissing. Each call dismisses one layer.
 */
export function advanceMemberSafetyHandoff(input: {
  pending: MemberSafetyHandoff | null;
  profileVisible: boolean;
  requestsVisible: boolean;
  findVisible: boolean;
}): {
  pending: MemberSafetyHandoff | null;
  dismissProfile: boolean;
  dismissRequests: boolean;
  dismissFind: boolean;
  present: MemberSafetyHandoff | null;
} {
  if (!input.pending) {
    return {
      pending: null,
      dismissProfile: false,
      dismissRequests: false,
      dismissFind: false,
      present: null,
    };
  }
  if (input.profileVisible) {
    return {
      pending: input.pending,
      dismissProfile: true,
      dismissRequests: false,
      dismissFind: false,
      present: null,
    };
  }
  if (input.requestsVisible) {
    return {
      pending: input.pending,
      dismissProfile: false,
      dismissRequests: true,
      dismissFind: false,
      present: null,
    };
  }
  if (input.findVisible) {
    return {
      pending: input.pending,
      dismissProfile: false,
      dismissRequests: false,
      dismissFind: true,
      present: null,
    };
  }
  return {
    pending: null,
    dismissProfile: false,
    dismissRequests: false,
    dismissFind: false,
    present: input.pending,
  };
}

const USER_ID = /^\S{1,255}$/;
const SERVER_CODE = /^[a-z0-9_]{1,80}$/;
const INT32_MAX = 2_147_483_647;

export type MemberSafetyFailure =
  | 'configuration'
  | 'token'
  | 'network'
  | 'timeout'
  | 'cancelled'
  | 'schema'
  | 'invalid_body'
  | 'self_report'
  | 'self_block'
  | 'invalid_message_reference'
  | 'invalid_block_id'
  | 'unauthorized'
  | 'membership_required'
  | 'member_not_found'
  | 'block_not_found'
  | 'unavailable';

export interface MemberReportReceipt {
  id: number;
  type: 'member_report';
  status: 'new';
  createdAt: string;
}

export interface MemberBlockReceipt {
  id: number;
  createdAt: string;
}

export interface BlockedMember extends MemberBlockReceipt {
  targetUserId: string | null;
  firstName: string | null;
  lastName: string | null;
  imageUrl: string | null;
}

const refreshListeners = new Set<() => void>();

export function isMemberSafetyEnabled(input?: {
  connectionsFlag?: string;
  messagesFlag?: string;
  nativeAuthTest?: boolean;
}): boolean {
  return isMemberConnectionsIntegrationEnabled({
    flag: input?.connectionsFlag,
    nativeAuthTest: input?.nativeAuthTest,
  }) || isMemberMessagesIntegrationEnabled({
    flag: input?.messagesFlag,
    nativeAuthTest: input?.nativeAuthTest,
  });
}

export function subscribeMemberSafetyRefresh(listener: () => void): () => void {
  refreshListeners.add(listener);
  return () => {
    refreshListeners.delete(listener);
  };
}

/** Drops cached conversations and connection snapshots, then asks open screens to reload. */
export function publishMemberSafetyRefresh(): void {
  clearMemberMessagesCache();
  clearMemberConnectionsCache();
  for (const listener of refreshListeners) listener();
}

export function memberReportReasonLabel(reason: MemberReportReason): string {
  switch (reason) {
    case 'harassment':
      return 'Harassment';
    case 'spam':
      return 'Spam';
    case 'impersonation':
      return 'Impersonation';
    case 'inappropriate_content':
      return 'Inappropriate content';
    case 'safety_concern':
      return 'Safety concern';
    case 'other':
      return 'Other';
  }
}

export function memberReportRequestBody(input: {
  targetUserId: string;
  reason: string;
  description?: string;
  messageId?: number;
}): { ok: true; body: { targetUserId: string; reason: MemberReportReason; description?: string; messageId?: number } }
  | { ok: false; code: 'invalid_body' } {
  const targetUserId = input.targetUserId.trim();
  if (!USER_ID.test(targetUserId)) return { ok: false, code: 'invalid_body' };
  if (!(MEMBER_REPORT_REASONS as readonly string[]).includes(input.reason)) {
    return { ok: false, code: 'invalid_body' };
  }
  const body: {
    targetUserId: string;
    reason: MemberReportReason;
    description?: string;
    messageId?: number;
  } = { targetUserId, reason: input.reason as MemberReportReason };
  if (input.description !== undefined && input.description.trim().length > 0) {
    const description = input.description.trim();
    if (description.length > MEMBER_REPORT_DESCRIPTION_MAX) return { ok: false, code: 'invalid_body' };
    body.description = description;
  }
  if (input.messageId !== undefined) {
    if (!Number.isInteger(input.messageId) || input.messageId < 1 || input.messageId > INT32_MAX) {
      return { ok: false, code: 'invalid_body' };
    }
    body.messageId = input.messageId;
  }
  return { ok: true, body };
}

export function memberBlockRequestBody(targetUserId: string):
  | { ok: true; body: { targetUserId: string } }
  | { ok: false; code: 'invalid_body' } {
  const id = targetUserId.trim();
  if (!USER_ID.test(id)) return { ok: false, code: 'invalid_body' };
  return { ok: true, body: { targetUserId: id } };
}

export function presentMemberReportSuccess(): string {
  return 'Report submitted. Bluebird will review it privately.';
}

export function presentMemberBlockConfirmation(): string {
  return 'Block this member? You will not be able to message each other or send new connection requests. Existing connections and message history stay in place. The member is not told that you blocked them.';
}

export function presentMemberBlockSuccess(): string {
  return 'This member is blocked. You can’t message each other or send new connection requests. Existing connections and past messages stay in place.';
}

export function presentMemberSafetyFailure(code: MemberSafetyFailure): string {
  switch (code) {
    case 'self_report':
      return 'You can’t report your own account.';
    case 'self_block':
      return 'You can’t block your own account.';
    case 'invalid_message_reference':
      return 'That message can’t be included in this report.';
    case 'member_not_found':
      return 'That member is not available.';
    case 'block_not_found':
      return 'That block is no longer available.';
    case 'invalid_block_id':
      return 'That block couldn’t be removed.';
    case 'membership_required':
      return 'An active Bluebird membership is required.';
    case 'unauthorized':
    case 'token':
      return 'Sign in again to continue.';
    case 'invalid_body':
      return 'Check the report details and try again.';
    case 'network':
    case 'timeout':
      return 'That couldn’t be sent. Try again.';
    case 'configuration':
    case 'unavailable':
    case 'schema':
    case 'cancelled':
      return 'That couldn’t be completed. Try again.';
  }
}

export function presentMemberAccessClosed(): string {
  return 'This conversation is no longer available.';
}

export function blockedMemberDisplayName(member: {
  firstName: string | null;
  lastName: string | null;
}): string {
  const name = [member.firstName, member.lastName]
    .map((part) => part?.trim() ?? '')
    .filter((part) => part.length > 0)
    .join(' ');
  return name || 'Unavailable member';
}

export function presentBlockedMembersEmpty(): string {
  return 'You have not blocked any members.';
}

export function presentBlockedMemberUnblockConfirmation(): string {
  return 'Unblock this member? You can message them again only if you are already connected. This does not send or accept a connection request.';
}

export function blockedMembersAfterUnblock<T extends { id: number }>(
  blocks: readonly T[],
  blockId: number,
  succeeded: boolean,
): T[] {
  if (!succeeded) return [...blocks];
  return blocks.filter((block) => block.id !== blockId);
}

/**
 * A connection is blocked by the current member only when the block list names
 * that member. Missing target ids and another member's block are not a match.
 */
export function outgoingBlockForMember(
  blocks: readonly BlockedMember[],
  userId: string | null | undefined,
): BlockedMember | null {
  const id = userId?.trim() ?? '';
  if (!USER_ID.test(id)) return null;
  return blocks.find((block) => block.targetUserId === id) ?? null;
}

function schemaFailure(field: string): never {
  throw new TypeError(field);
}

function objectValue(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) schemaFailure(field);
  return value as Record<string, unknown>;
}

function positiveId(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > INT32_MAX) schemaFailure(field);
  return value;
}

function dateTime(value: unknown, field: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) schemaFailure(field);
  return value;
}

export function parseMemberReportReceipt(value: unknown): { report: MemberReportReceipt } {
  const raw = objectValue(value, 'memberReport');
  const report = objectValue(raw.report, 'memberReport.report');
  if (report.type !== 'member_report') schemaFailure('memberReport.report.type');
  if (report.status !== 'new') schemaFailure('memberReport.report.status');
  return {
    report: {
      id: positiveId(report.id, 'memberReport.report.id'),
      type: 'member_report',
      status: 'new',
      createdAt: dateTime(report.createdAt, 'memberReport.report.createdAt'),
    },
  };
}

export function parseMemberBlockReceipt(value: unknown): { block: MemberBlockReceipt } {
  const raw = objectValue(value, 'memberBlock');
  const block = objectValue(raw.block, 'memberBlock.block');
  return {
    block: {
      id: positiveId(block.id, 'memberBlock.block.id'),
      createdAt: dateTime(block.createdAt, 'memberBlock.block.createdAt'),
    },
  };
}

function optionalProfileText(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;
  return text.slice(0, 80);
}

function optionalHttpsUrl(value: unknown): string | null {
  if (value == null || typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || text.length > 2000) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return text;
  } catch {
    return null;
  }
}

function optionalUserId(value: unknown): string | null {
  if (value == null || typeof value !== 'string') return null;
  const id = value.trim();
  return USER_ID.test(id) ? id : null;
}

export function parseBlockedMember(value: unknown, field: string): BlockedMember {
  const row = objectValue(value, field);
  return {
    id: positiveId(row.id, `${field}.id`),
    createdAt: dateTime(row.createdAt, `${field}.createdAt`),
    targetUserId: optionalUserId(row.targetUserId),
    firstName: optionalProfileText(row.firstName),
    lastName: optionalProfileText(row.lastName),
    imageUrl: optionalHttpsUrl(row.imageUrl),
  };
}

export function parseMemberBlockList(value: unknown): { blocks: BlockedMember[] } {
  const raw = objectValue(value, 'memberBlocks');
  if (!Array.isArray(raw.blocks)) schemaFailure('memberBlocks.blocks');
  return {
    blocks: raw.blocks.map((item, index) => parseBlockedMember(item, `memberBlocks.blocks.${index}`)),
  };
}

export function parseMemberUnblockResult(value: unknown): { removed: true } {
  const raw = objectValue(value, 'memberUnblock');
  if (raw.removed !== true) schemaFailure('memberUnblock.removed');
  return { removed: true };
}

function failureCode(error: unknown, kind: 'report' | 'block' | 'unblock'): MemberSafetyFailure {
  if (error instanceof ProductionAuthHttpError) {
    const code = error.serverCode;
    if (error.status === 401) return 'unauthorized';
    if (error.status === 403 && code === 'active_membership_required') return 'membership_required';
    if (error.status === 403) return 'unavailable';
    if (kind === 'report') {
      if (error.status === 400 && code === 'self_report') return 'self_report';
      if (error.status === 400 && code === 'invalid_message_reference') return 'invalid_message_reference';
      if (error.status === 400) return 'invalid_body';
      if (error.status === 404 && code === 'member_not_found') return 'member_not_found';
      if (error.status === 404) return 'member_not_found';
    }
    if (kind === 'block') {
      if (error.status === 400 && code === 'self_block') return 'self_block';
      if (error.status === 400) return 'invalid_body';
      if (error.status === 404) return 'member_not_found';
    }
    if (kind === 'unblock') {
      if (error.status === 400 && code === 'invalid_block_id') return 'invalid_block_id';
      if (error.status === 400) return 'invalid_body';
      if (error.status === 404) return 'block_not_found';
    }
    return 'unavailable';
  }
  if (error instanceof ProductionAuthCancelledError) return 'cancelled';
  if (error instanceof ProductionAuthTimeoutError) return 'timeout';
  if (error instanceof ProductionAuthNetworkError) return 'network';
  if (error instanceof ProductionAuthSchemaError || error instanceof ProductionAuthInvalidJsonError) return 'schema';
  if (error instanceof ProductionAuthRequestError && error.code === 'token') return 'token';
  return 'unavailable';
}

async function readSafetyError(response: Response): Promise<{ code: string | null; body: null }> {
  try {
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { code: null, body: null };
    const code = (payload as { code?: unknown }).code;
    return { code: typeof code === 'string' && SERVER_CODE.test(code) ? code : null, body: null };
  } catch {
    return { code: null, body: null };
  }
}

export interface MemberSafetyClientOptions {
  enabled: boolean;
  nativeAuthTest?: boolean;
  environment: MainBluebirdApiEnvironment;
  baseUrl: string;
  getAccessToken: () => Promise<string | null>;
  fetcher?: typeof fetch;
}

export function createMemberSafetyClient(options: MemberSafetyClientOptions) {
  const live = options.enabled === true && options.nativeAuthTest !== true;

  async function request<T>(
    path: string,
    method: 'GET' | 'POST' | 'DELETE',
    parse: (value: unknown) => T,
    kind: 'report' | 'block' | 'unblock',
    body?: Record<string, string | number>,
  ): Promise<{ kind: 'disabled' } | { kind: 'loaded'; data: T } | { kind: 'error'; code: MemberSafetyFailure }> {
    if (!live) return { kind: 'disabled' };
    let baseUrl: string;
    try {
      baseUrl = validateMainBluebirdApiBaseUrl(options.baseUrl, options.environment);
    } catch {
      return { kind: 'error', code: 'configuration' };
    }
    try {
      const data = await requestProductionJson({
        url: `${baseUrl}${path}`,
        fetcher: options.fetcher ?? fetch,
        method,
        headers: {
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        credentials: 'omit',
        timeoutMs: PRODUCTION_AUTH_TIMEOUT_MS,
        prepareHeaders: async () => {
          let token: string | null;
          try {
            token = await options.getAccessToken();
          } catch {
            throw new ProductionAuthRequestError('Main API access token is unavailable.', 'token');
          }
          if (typeof token !== 'string' || token.trim() === '' || /\s/.test(token)) {
            throw new ProductionAuthRequestError('Main API access token is unavailable.', 'token');
          }
          return { Authorization: `Bearer ${token}` };
        },
        parse,
        errors: {
          timeout: (duration) => new ProductionAuthTimeoutError(duration),
          cancelled: () => new ProductionAuthCancelledError(),
          network: () => new ProductionAuthNetworkError(),
          http: async (response) => new ProductionAuthHttpError(response.status, await readSafetyError(response)),
          invalidJson: () => new ProductionAuthInvalidJsonError(),
          schema: (error) => new ProductionAuthSchemaError(error instanceof Error ? error.message : 'response'),
        },
      });
      return { kind: 'loaded', data };
    } catch (error) {
      return { kind: 'error', code: failureCode(error, kind) };
    }
  }

  return {
    report: (input: {
      targetUserId: string;
      reason: string;
      description?: string;
      messageId?: number;
    }) => {
      if (!live) return Promise.resolve({ kind: 'disabled' } as const);
      const body = memberReportRequestBody(input);
      if (!body.ok) return Promise.resolve({ kind: 'error', code: body.code } as const);
      return request(MEMBER_REPORT_PATH, 'POST', parseMemberReportReceipt, 'report', body.body);
    },
    block: (targetUserId: string) => {
      if (!live) return Promise.resolve({ kind: 'disabled' } as const);
      const body = memberBlockRequestBody(targetUserId);
      if (!body.ok) return Promise.resolve({ kind: 'error', code: body.code } as const);
      return request(MEMBER_BLOCKS_PATH, 'POST', parseMemberBlockReceipt, 'block', body.body);
    },
    listBlocks: () => request(MEMBER_BLOCKS_PATH, 'GET', parseMemberBlockList, 'block'),
    unblock: (blockId: number) => {
      if (!live) return Promise.resolve({ kind: 'disabled' } as const);
      if (!Number.isInteger(blockId) || blockId < 1 || blockId > INT32_MAX) {
        return Promise.resolve({ kind: 'error', code: 'invalid_block_id' } as const);
      }
      return request(`${MEMBER_BLOCKS_PATH}/${blockId}`, 'DELETE', parseMemberUnblockResult, 'unblock');
    },
  };
}
