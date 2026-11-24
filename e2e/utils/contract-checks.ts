/**
 * Requirement checks that can be made on the bundled spec alone, before the backend exists.
 */
import type { OperationInfo } from './permission-matrix';

const MUTATING = new Set(['put', 'patch', 'delete', 'post']);

/**
 * P1-AUD-02: the audit log has no update/delete endpoint. Any PUT/PATCH/DELETE on an audit path,
 * or a POST other than the export/search allow-list, is a violation.
 */
export function findAuditMutations(
  operations: OperationInfo[],
  opts: { allowPost?: RegExp } = {},
): OperationInfo[] {
  const allowPost = opts.allowPost ?? /\/(export|search)$/;
  return operations.filter((op) => {
    const isAudit = op.tags.includes('audit') || /(^|\/)audit[-\w]*(\/|$)/.test(op.path);
    if (!isAudit || !MUTATING.has(op.method)) return false;
    return !(op.method === 'post' && allowPost.test(op.path));
  });
}

/** Operations whose x-requirements mention a requirement id (traceability from API to plan). */
export function operationsForRequirement(operations: OperationInfo[], requirementId: string): OperationInfo[] {
  return operations.filter((op) => op.requirements.includes(requirementId));
}
