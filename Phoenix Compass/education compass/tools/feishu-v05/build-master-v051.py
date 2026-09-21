#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
按 feishuv0.5.docx 生成 V0.5.1 母版。

输入：
  - Phoenix_Feishu_Operating_Model_V0.5_Clean_Master.xlsx（2026-09-11 底稿）
  - feishuv0.5.docx 的字段调整要求（2026-09-20，最新，以它为准）
  - 飞书现状里 AI 展开时新增的列（逐列裁定，不整批采信）

取舍规则只有一条：
  凡与底稿已有列语义重复的一律丢弃，保留底稿列名；
  凡底稿没有覆盖的能力才采纳。每条决定都记在 DECISIONS 里，输出到 README 页。

用法：
    python tools/feishu-v05/build-master-v051.py
"""

import importlib.util
import io
import json
import os
import sys

import openpyxl
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

HERE = os.path.dirname(os.path.abspath(__file__))
# 底稿，不是当前基线 —— 当前基线就是本脚本的输出，读它会自噬
DRAFT_XLSX = os.path.join(HERE, 'Phoenix_Feishu_Operating_Model_V0.5_Clean_Master.xlsx')
OUT_XLSX = os.path.join(HERE, 'Phoenix_Feishu_Operating_Model_V0.5.1_Master.xlsx')


def load_draft_tables():
    """直接从 9/11 底稿抽表结构，复用 extract-master.py 的解析逻辑"""
    spec = importlib.util.spec_from_file_location('extract_master', os.path.join(HERE, 'extract-master.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.extract(DRAFT_XLSX)['tables']

FONT = 'Arial'
TEXT, NUMBER, SELECT, CHECKBOX = 1, 2, 3, 7

# ── 合并后的交付表：docx「Delivery／Application 合并为一张交付表，用 Record Type 区分」
DELIVERIES_SHEET = 'Deliveries'
RECORD_TYPE_OPTIONS = ['SERVICE_DELIVERY', 'SCHOOL_APPLICATION']

# ── Schools：按飞书 tblqZV6kUlrWdFLD 的现有结构抽出的草案。
# docx 只说「School 仍然独立于 Partner，关系是 Student → Application → School」，
# 没规定它是一张表还是挂在申请上的字段。这里照抄飞书现状收进母版，
# 时间列按母版惯例统一成单行文本（飞书那边建的是日期字段）。
# 未决：Deliveries 的 School Subject Ref 是否改为引用 Schools.School ID。
SCHOOLS_DRAFT = [
    ('School ID', TEXT, None, 'PN-SCH-0001'),
    ('School Code', TEXT, None, 'SCH-HK-0001'),
    ('School Name', TEXT, None, '示例大学'),
    ('Region', TEXT, None, 'HK'),
    ('School Type', SELECT, ['HIGH_SCHOOL', 'UNIVERSITY', 'GRADUATE_SCHOOL', 'OTHER'], 'UNIVERSITY'),
    ('Cooperation Status', SELECT,
     ['PROSPECTING', 'NEGOTIATING', 'SIGNED', 'ACTIVE', 'PAUSED', 'TERMINATED'], 'ACTIVE'),
    ('Account Manager', TEXT, None, 'Katrina'),
    ('Agreement Ref', TEXT, None, ''),
    ('Commission Eligible', CHECKBOX, None, False),
    ('Status', SELECT, ['ACTIVE', 'INACTIVE', 'DRAFT', 'ARCHIVED'], 'ACTIVE'),
    ('Created At', TEXT, None, ''),
    ('Updated At', TEXT, None, ''),
]

# ── 逐列裁定。action: keep 采纳 / drop 丢弃 / rename 改名
DECISIONS = [
    # Partners
    ('Partners', 'Agreement Ref', 'keep', '底稿只有 Commission Rule ID，没有合作协议引用'),
    ('Partners', 'Source Owner Type', 'drop', '底稿 Source Owner 已表达原始归属，docx 未要求再拆类型'),
    ('Partners', 'Source Owner ID', 'drop', '同上，避免与 Source Owner 语义重复'),
    ('Partners', 'Created At', 'keep', '审计时间戳，底稿在 Deals 上已有此惯例'),
    ('Partners', 'Updated At', 'keep', '同上'),
    # Products_Services：套餐父子结构本次不做，9 列全丢
    ('Products_Services', 'Record ID', 'drop', '与 Product ID 重复'),
    ('Products_Services', 'Record Type', 'drop', '父子结构本次不做'),
    ('Products_Services', 'Package ID', 'drop', '父子结构本次不做'),
    ('Products_Services', 'Service ID', 'drop', '父子结构本次不做'),
    ('Products_Services', 'Code', 'drop', '与 Product ID 重复'),
    ('Products_Services', 'Name', 'drop', '与 Product Name 重复'),
    ('Products_Services', 'Delivery Unit', 'drop', '与 Unit 重复'),
    ('Products_Services', 'Included Quantity', 'drop', '父子结构本次不做'),
    ('Products_Services', 'Parent Record Ref', 'drop', '父子结构本次不做'),
    # Delivery（并入 Deliveries）
    ('Delivery', 'Delivery ID', 'drop', '与 Delivery Event ID 重复'),
    ('Delivery', 'Service ID', 'drop', '依附于已放弃的父子结构'),
    ('Delivery', 'Milestone Type', 'drop', 'Delivery Type 的 MILESTONE 取值已覆盖'),
    ('Delivery', 'Total Quantity', 'keep', '应交付总量，底稿只有已交付的 Units Delivered'),
    ('Delivery', 'Owner', 'keep', '合并后需要统一的负责人列'),
    ('Delivery', 'Completed At', 'drop', '与 Delivered At 重复'),
    ('Delivery', 'Updated At', 'keep', '审计时间戳'),
    # Applications（并入 Deliveries）
    ('Applications', 'School Role', 'drop', '与 School Role Ref 重复'),
    ('Applications', 'School Ref', 'drop', '与 School Subject Ref 重复'),
    ('Applications', 'Consent Snapshot', 'drop', 'docx 要求只在必要时引用 consent_id，不留快照'),
    ('Applications', 'Offer Received At', 'keep', '底稿只有 Offer Date，里程碑时间补全'),
    ('Applications', 'Deposit Paid At', 'keep', '同上'),
    ('Applications', 'Enrolled At', 'keep', '同上'),
    ('Applications', 'Created At', 'keep', '审计时间戳'),
    ('Applications', 'Updated At', 'drop', 'Delivery 侧已采纳同名列，合并后只留一个'),
    # Settlements
    ('Settlements', 'Money Type', 'rename', 'docx 指定用 Settlement Type 区分四类资金'),
    ('Settlements', 'Business Basis Key', 'drop', '底稿 Source Ref Type + Source Ref ID 已表达业务依据'),
    ('Settlements', 'Beneficiary / Counterparty ID', 'drop', '与 Counterparty Subject Ref 重复'),
    ('Settlements', 'Period Start', 'keep', '结算周期，底稿没有'),
    ('Settlements', 'Period End', 'keep', '同上'),
    # Integration_Links
    ('Integration_Links', 'Source of Truth', 'keep', 'docx 点名要求的列，底稿没有'),
]

# 采纳的新列各自的类型与下拉
NEW_FIELD_SPEC = {
    'Agreement Ref': (TEXT, None),
    'Created At': (TEXT, None),
    'Updated At': (TEXT, None),
    'Total Quantity': (NUMBER, None),
    'Owner': (TEXT, None),
    'Offer Received At': (TEXT, None),
    'Deposit Paid At': (TEXT, None),
    'Enrolled At': (TEXT, None),
    'Period Start': (TEXT, None),
    'Period End': (TEXT, None),
    'Source of Truth': (SELECT, ['PHOENIX_CORE', 'PHOENIX_FOUNDER_OS', 'FAMILY_OS', 'FEISHU', 'ASKWISE']),
}


def decisions_for(sheet, action):
    return [(col, why) for s, col, act, why in DECISIONS if s == sheet and act == action]


def field(name, ftype, options=None, sample=None):
    item = {'name': name, 'type': ftype}
    if options:
        item['options'] = options
    if sample is not None:
        item['sample'] = sample
    return item


def build_tables(base):
    """base: master-contract.json 的 tables，按裁定结果产出 V0.5.1 的表清单"""
    by_sheet = {t['sheet']: t for t in base}
    tables = []

    for sheet in ['Family_Student_View', 'Partners', 'Products_Services', 'Deals',
                  'Contracts', 'Payments', 'Service_Projects']:
        source = by_sheet[sheet]
        fields = [field(f['name'], f['type'], f.get('options'), f.get('sample')) for f in source['fields']]
        for col, _ in decisions_for(sheet, 'keep'):
            ftype, options = NEW_FIELD_SPEC[col]
            fields.append(field(col, ftype, options))
        tables.append({'sheet': sheet, 'unique': source['unique'], 'fields': fields})

    # ── 合并交付表
    delivery = by_sheet['Delivery']
    applications = by_sheet['Applications']
    dropped = {col for col, _ in decisions_for('Delivery', 'drop')} | {
        col for col, _ in decisions_for('Applications', 'drop')}

    merged = [
        field('Delivery Record ID', TEXT, sample='PN-DLV-0001'),
        field('Record Type', SELECT, RECORD_TYPE_OPTIONS, sample='SERVICE_DELIVERY'),
    ]
    seen = {'Delivery Record ID', 'Record Type'}
    # Service Project ID 是两张表共同的父链接，放在最前
    for source in (delivery, applications):
        for f in source['fields']:
            name = f['name']
            if name in seen or name in dropped:
                continue
            # 原来的两个主键并入普通列，用合并后的新主键取代
            if name in ('Delivery Event ID', 'Application ID'):
                continue
            seen.add(name)
            merged.append(field(name, f['type'], f.get('options'), f.get('sample')))
    for col, _ in decisions_for('Delivery', 'keep'):
        if col in seen:
            continue
        seen.add(col)
        ftype, options = NEW_FIELD_SPEC[col]
        merged.append(field(col, ftype, options))
    for col, _ in decisions_for('Applications', 'keep'):
        if col in seen:
            continue
        seen.add(col)
        ftype, options = NEW_FIELD_SPEC[col]
        merged.append(field(col, ftype, options))
    tables.append({'sheet': DELIVERIES_SHEET, 'unique': 'Delivery Record ID', 'fields': merged})

    # ── Settlements：Money Type 改名为 Settlement Type
    settlements = by_sheet['Settlements']
    fields = []
    for f in settlements['fields']:
        name = 'Settlement Type' if f['name'] == 'Money Type' else f['name']
        fields.append(field(name, f['type'], f.get('options'), f.get('sample')))
    for col, _ in decisions_for('Settlements', 'keep'):
        ftype, options = NEW_FIELD_SPEC[col]
        fields.append(field(col, ftype, options))
    tables.append({'sheet': 'Settlements', 'unique': settlements['unique'], 'fields': fields})

    # ── Schools：草案，来源是飞书现有表，不来自底稿
    tables.append({
        'sheet': 'Schools',
        'unique': SCHOOLS_DRAFT[0][0],
        'draft': True,
        'fields': [field(name, ftype, options, sample if sample != '' else None)
                   for name, ftype, options, sample in SCHOOLS_DRAFT],
    })

    # ── Integration_Links：补 Source of Truth
    links = by_sheet['Integration_Links']
    fields = [field(f['name'], f['type'], f.get('options'), f.get('sample')) for f in links['fields']]
    for col, _ in decisions_for('Integration_Links', 'keep'):
        ftype, options = NEW_FIELD_SPEC[col]
        fields.append(field(col, ftype, options))
    tables.append({'sheet': 'Integration_Links', 'unique': links['unique'], 'fields': fields})

    return tables


HEADER_FILL = PatternFill('solid', fgColor='1F3864')
NOTE_FILL = PatternFill('solid', fgColor='FFF2CC')


def write_readme(workbook, tables):
    sheet = workbook.create_sheet('README', 0)
    rows = [
        ['Phoenix Feishu Operating Model V0.5.1 Master'],
        [],
        ['来源', '说明'],
        ['底稿', 'Phoenix_Feishu_Operating_Model_V0.5_Clean_Master.xlsx（2026-09-11）'],
        ['要求', 'feishuv0.5.docx（2026-09-20，最新，冲突时以它为准）'],
        ['飞书现状', 'AI 按优化提示词 + 底稿展开所建，新增列逐列裁定，不整批采信'],
        ['取舍规则', '与底稿语义重复的一律丢弃并保留底稿列名；底稿未覆盖的能力才采纳'],
        [],
        ['本版相对底稿的三处结构改动', ''],
        ['1', 'Delivery 与 Applications 合并为 Deliveries，用 Record Type 区分 SERVICE_DELIVERY / SCHOOL_APPLICATION'],
        ['2', 'Settlements 的 Money Type 改名为 Settlement Type'],
        ['3', 'Integration_Links 增加 Source of Truth'],
        [],
        ['草案（未经业务确认）', ''],
        ['Schools',
         '照飞书现有表结构收入母版。docx 只要求 School 语义独立于 Partner，未规定独立建表。'
         '未决：Deliveries 的 School Subject Ref 是否改为引用 Schools.School ID；'
         '学校返佣从 Application 还是从 School 侧起算。'],
        [],
        ['表', '主字段', '列数'],
    ]
    for table in tables:
        label = table['sheet'] + ('（草案）' if table.get('draft') else '')
        rows.append([label, table['unique'], len(table['fields'])])
    rows.extend([[], ['飞书新增列的逐列裁定', '', ''], ['原表', '列', '处理', '理由']])
    for s, col, act, why in DECISIONS:
        label = {'keep': '采纳', 'drop': '丢弃', 'rename': '改名'}[act]
        rows.append([s, col, label, why])

    for row in rows:
        sheet.append(row)
    sheet['A1'].font = Font(name=FONT, bold=True, size=14)
    for cell in ('A3', 'B3', 'A14', 'B14', 'C14'):
        sheet[cell].font = Font(name=FONT, bold=True)
    for row in sheet.iter_rows():
        for cell in row:
            if cell.font.size != 14 and not cell.font.bold:
                cell.font = Font(name=FONT)
            cell.alignment = Alignment(vertical='top', wrap_text=True)
    sheet.column_dimensions['A'].width = 24
    sheet.column_dimensions['B'].width = 30
    sheet.column_dimensions['C'].width = 10
    sheet.column_dimensions['D'].width = 60


def write_table(workbook, table):
    sheet = workbook.create_sheet(table['sheet'])
    names = [f['name'] for f in table['fields']]
    sheet.append(names)
    sheet.append([f.get('sample', '') for f in table['fields']])

    for index, item in enumerate(table['fields'], start=1):
        letter = get_column_letter(index)
        header = sheet.cell(row=1, column=index)
        header.font = Font(name=FONT, bold=True, color='FFFFFF')
        header.fill = HEADER_FILL
        header.alignment = Alignment(vertical='center', wrap_text=True)
        sheet.cell(row=2, column=index).font = Font(name=FONT)
        sheet.column_dimensions[letter].width = max(14, min(32, len(item['name']) + 6))
        if item.get('options'):
            formula = '"%s"' % ','.join(item['options'])
            if len(formula) <= 255:
                validation = DataValidation(type='list', formula1=formula, allow_blank=True)
                sheet.add_data_validation(validation)
                validation.add('%s2:%s500' % (letter, letter))
            else:
                sheet.cell(row=2, column=index).fill = NOTE_FILL
    sheet.freeze_panes = 'A2'


def main():
    tables = build_tables(load_draft_tables())

    workbook = openpyxl.Workbook()
    workbook.remove(workbook.active)
    write_readme(workbook, tables)
    for table in tables:
        write_table(workbook, table)
    workbook.save(OUT_XLSX)

    total = sum(len(t['fields']) for t in tables)
    print('生成 %s' % os.path.basename(OUT_XLSX))
    print('  %d 张表 / %d 个字段' % (len(tables), total))
    for table in tables:
        selects = sum(1 for f in table['fields'] if f.get('options'))
        print('  %-22s 列=%-3d 下拉=%-2d 主字段=%s' % (table['sheet'], len(table['fields']), selects, table['unique']))
    kept = sum(1 for _, _, a, _ in DECISIONS if a == 'keep')
    dropped = sum(1 for _, _, a, _ in DECISIONS if a == 'drop')
    renamed = sum(1 for _, _, a, _ in DECISIONS if a == 'rename')
    print('  飞书新增列裁定：采纳 %d / 丢弃 %d / 改名 %d' % (kept, dropped, renamed))


if __name__ == '__main__':
    main()
