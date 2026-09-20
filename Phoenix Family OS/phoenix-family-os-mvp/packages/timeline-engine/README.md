# timeline-engine

状态：结构预留，无独立 package.json 或可导入模块。

职责：事件添加、查询、家庭关联与时间排序。

当前来源：

- [services/repository.js](../../services/repository.js)
- [utils/date.js](../../utils/date.js)

未来抽取 addTimeline/eventsForFamily；保留原事件与时间排序行为，不能把展示排序等同于可篡改审计日志。
