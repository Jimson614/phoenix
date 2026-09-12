import { EntityMap, TableName } from '../domain/model'

export type Filter<T> = Partial<{ [K in keyof T]: T[K] }>

export interface StoreTransaction {
  findById<K extends TableName>(table: K, id: string, options?: { forUpdate?: boolean }): Promise<EntityMap[K] | null>
  findOne<K extends TableName>(table: K, filter: Filter<EntityMap[K]>, options?: { forUpdate?: boolean }): Promise<EntityMap[K] | null>
  findMany<K extends TableName>(table: K, filter?: Filter<EntityMap[K]>): Promise<EntityMap[K][]>
  insert<K extends TableName>(table: K, value: EntityMap[K]): Promise<EntityMap[K]>
  update<K extends TableName>(table: K, id: string, changes: Partial<EntityMap[K]>): Promise<EntityMap[K]>
  delete<K extends TableName>(table: K, id: string): Promise<boolean>
}

export interface Store {
  read<T>(work: (tx: StoreTransaction) => Promise<T>): Promise<T>
  transaction<T>(work: (tx: StoreTransaction) => Promise<T>): Promise<T>
  close?(): Promise<void>
}
