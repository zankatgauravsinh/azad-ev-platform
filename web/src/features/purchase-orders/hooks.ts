import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CancelPurchaseOrderInput, PurchaseOrderDocumentType, UpdatePurchaseOrderInput } from '@azad/shared';
import { purchaseOrdersApi, type PurchaseOrderListParams } from './api';

export const purchaseOrderKeys = {
  all: ['purchase-orders'] as const,
  list: (q: PurchaseOrderListParams) => ['purchase-orders', 'list', q] as const,
  detail: (id: string) => ['purchase-orders', 'detail', id] as const,
};

export const usePurchaseOrders = (q: PurchaseOrderListParams, enabled = true) =>
  useQuery({ queryKey: purchaseOrderKeys.list(q), queryFn: () => purchaseOrdersApi.list(q), enabled });
export const usePurchaseOrder = (id: string | undefined) =>
  useQuery({ queryKey: purchaseOrderKeys.detail(id ?? ''), queryFn: () => purchaseOrdersApi.get(id as string), enabled: Boolean(id) });

/** An order's changes reach its vendor's page (open orders, advances) too. */
export function usePurchaseOrderMutations() {
  const qc = useQueryClient();
  const onSuccess = async (): Promise<void> => {
    await Promise.all([purchaseOrderKeys.all, ['vendor-payables']].map((queryKey) => qc.invalidateQueries({ queryKey })));
  };
  return {
    create: useMutation({ mutationFn: purchaseOrdersApi.create, onSuccess }),
    update: useMutation({ mutationFn: (v: { id: string; body: UpdatePurchaseOrderInput }) => purchaseOrdersApi.update(v.id, v.body), onSuccess }),
    markOrdered: useMutation({ mutationFn: purchaseOrdersApi.markOrdered, onSuccess }),
    close: useMutation({ mutationFn: purchaseOrdersApi.close, onSuccess }),
    reopen: useMutation({ mutationFn: purchaseOrdersApi.reopen, onSuccess }),
    cancel: useMutation({ mutationFn: (v: { id: string; body: CancelPurchaseOrderInput }) => purchaseOrdersApi.cancel(v.id, v.body), onSuccess }),
    addDocument: useMutation({ mutationFn: (v: { id: string; file: File; type: PurchaseOrderDocumentType }) => purchaseOrdersApi.addDocument(v.id, v.file, v.type), onSuccess }),
    removeDocument: useMutation({ mutationFn: (v: { id: string; documentId: string }) => purchaseOrdersApi.removeDocument(v.id, v.documentId), onSuccess }),
  };
}
