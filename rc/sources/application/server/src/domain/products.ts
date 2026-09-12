import { Product, ProductDeliverable } from './model'

export const COMPASS_PRODUCT_CODE = 'COMPASS_REPORT_SINGLE_39_9' as const
export const GROWTH_DISCOVERY_PRODUCT_CODE = 'EDUCATION_GROWTH_DISCOVERY_SINGLE_V1' as const
export const MEMBER_PRODUCT_CODE = 'PHOENIX_MEMBER_199' as const

export function defaultProducts(now: string): Product[] {
  return [
    {
      id: GROWTH_DISCOVERY_PRODUCT_CODE,
      code: GROWTH_DISCOVERY_PRODUCT_CODE,
      name: 'Education Growth Discovery 单次报告',
      amountFen: 3990,
      currency: 'CNY',
      scope: 'SINGLE_REPORT',
      active: true,
      createdAt: now
    },
    {
      id: COMPASS_PRODUCT_CODE,
      code: COMPASS_PRODUCT_CODE,
      name: 'Phoenix Education Compass 单次完整报告',
      amountFen: 3990,
      currency: 'CNY',
      scope: 'SINGLE_REPORT',
      active: true,
      createdAt: now
    },
    {
      id: MEMBER_PRODUCT_CODE,
      code: MEMBER_PRODUCT_CODE,
      name: 'Phoenix Family OS 年度会员',
      amountFen: 19900,
      currency: 'CNY',
      scope: 'MEMBERSHIP',
      active: false,
      createdAt: now
    }
  ]
}

export function defaultProductDeliverables(now: string): ProductDeliverable[] {
  return [
    {
      id: 'DELIVERABLE_LEGACY_COMPASS_SINGLE',
      productCode: COMPASS_PRODUCT_CODE,
      assessmentKind: 'LEGACY_EDUCATION_COMPASS',
      reportKind: 'LEGACY_EDUCATION_COMPASS_REPORT',
      deliverableKind: 'LEGACY_COMPASS_REPORT_V1',
      active: true,
      createdAt: now,
      updatedAt: now
    },
    {
      id: 'DELIVERABLE_GROWTH_DISCOVERY_V1',
      productCode: GROWTH_DISCOVERY_PRODUCT_CODE,
      assessmentKind: 'STUDENT_GROWTH_DISCOVERY',
      reportKind: 'STUDENT_GROWTH_DISCOVERY',
      deliverableKind: 'STUDENT_GROWTH_DISCOVERY_REPORT_V1',
      active: true,
      createdAt: now,
      updatedAt: now
    }
  ]
}
