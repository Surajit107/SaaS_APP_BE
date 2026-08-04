export const PLATFORM_SUBSCRIPTION_LIST_SORT_BY_VALUES = [
  'updatedAt',
  'createdAt',
  'status',
  'planKey',
  'tenantName',
] as const;

export type PlatformSubscriptionListSortBy =
  (typeof PLATFORM_SUBSCRIPTION_LIST_SORT_BY_VALUES)[number];

export const PLATFORM_SUBSCRIPTION_LIST_SORT_ORDER_VALUES = [
  'asc',
  'desc',
] as const;

export type PlatformSubscriptionListSortOrder =
  (typeof PLATFORM_SUBSCRIPTION_LIST_SORT_ORDER_VALUES)[number];

export const PLATFORM_SUBSCRIPTION_LIST_DEFAULT_SORT_BY: PlatformSubscriptionListSortBy =
  'updatedAt';

export const PLATFORM_SUBSCRIPTION_LIST_DEFAULT_SORT_ORDER: PlatformSubscriptionListSortOrder =
  'desc';
