# P6 · A-01 至 A-34 验收台账

2026-10-27。产品定义以 [PRODUCT](../PRODUCT.md) 为准；本表逐项记录工程回归与外部证据，不把 Fake/合成样本等同于真实模型、客户端或真机。本轮回归起始基线 `90f1bab`，测试、工具及台账已提交为 `799359c`。

首次整理先标记本轮待复验，再按日志更新状态；原 P1–P5 历史证据保留。提交前最终后端全套 144 项及前端组件 21 项已通过，Chromium 桌面/Pixel 7 视口最终 18 项通过，详情见[本轮记录](../history/2026-10-27-p6-regression.md)。用户已反馈手机使用通过，不重复要求基本流程；未提供的信息不得补造。

后端入口均在 [backend/tests](../../backend/tests/)，浏览器入口在 [frontend/e2e](../../frontend/e2e/)。旧证据索引：[P2](../P2.md)、[P3](../history/2026-10-26-p3.md)、[P4](../history/2026-10-26-p4.md)、[P5](../history/2026-10-26-p5.md)、[识别](../history/2026-10-27-qwen-acceptance.md)、[v4搭配](../history/2026-10-27-outfit-v4-acceptance.md)、[Excel](../history/2026-10-27-excel-sample.md)、[天气](../history/2026-10-27-qweather.md)、[容量](../history/2026-10-27-backup-capacity.md)。

| ID | 逐项行为 | 当前源码/测试证据入口 | 本轮工程状态 | 外部边界或待补内容 |
|---|---|---|---|---|
| A-01 | 示例删除不复活 | `test_imports.py::test_demo_deleted_once_not_reseeded` | 通过（工程） | 无 |
| A-02 | 只填品类；未知保留、默认可穿 | `test_p6_acceptance.py::test_category_only_confirmation` | 通过（工程） | 已补仅品类入库的精确断言 |
| A-03 | 三图一行识别失败，其他可确认 | `test_p6_acceptance.py::test_three_photos_one_recognition_failure` | 通过（工程） | 已补精确三行场景 |
| A-04 | Excel 按锚点而非 ZIP 顺序匹配 | `test_media.py::test_excel_anchors_not_zip_image_order_and_row_errors` | 工程通过；外部待补 | Excel 客户端样例另待提供 |
| A-05 | Excel 属性保留，零识别覆盖 | `test_imports.py::test_excel_attributes_bypass_ai_and_invalid_row_is_editable` | 工程通过；外部待补 | Excel 客户端样例另待提供 |
| A-06 | HEIC 原件和原图/去背景切换 | `test_media.py::test_heic_conversion_and_real_cutout；wardrobe.spec.ts` | 工程通过；外部待补 | 真实 HEIC 原片缺失，合成输入不能替代 |
| A-07 | 不可用衣服排除 | `test_outfit_failures.py::test_unavailable_excluded_preferences_refreshed_and_sse_read_only` | 通过（工程） | 无 |
| A-08 | 按钮/聊天换裤子保持锁定外套 | `outfits.spec.ts；test_outfits.py::test_chat_clarification_and_specific_replacement` | 通过（工程） | 已补聊天后外套完整快照断言；v4真实模型复杂场景另待验 |
| A-09 | 锁定后不可用明确冲突 | `test_outfits.py::test_replace_preserves_every_non_target_and_lock_conflicts` | 通过（工程） | 无 |
| A-10 | 拒绝模型伪造单品 ID | `test_outfit_failures.py::test_invalid_ids_exhaust_one_repair_without_committing` | 通过（工程） | 模拟输出证明后端边界 |
| A-11 | 不足三套不凑数，未拥有单独表示 | `test_p6_acceptance.py::test_sparse_wardrobe_keeps_suggestions_separate` | 通过（工程） | 已补仅一件衣服及未拥有建议断言；真实非空建议另待验 |
| A-12 | 生成中刷新/关闭重开不重复调用 | `generating-isolated.scenario.ts；outfits.spec.ts 现有为完成后刷新` | 通过（工程） | Fake 调用处有界暂停，验证真实运行中浏览器恢复 |
| A-13 | SSE 去重、重连不重执行 | `test_jobs.py::test_success_and_sse_replay_never_reexecutes；sse.test.ts；generating-isolated.scenario.ts` | 通过（工程） | 实际移动网络切换不由组件测试替代 |
| A-14 | 删衣后历史快照/图片保留及失效提示 | `test_outfits.py::test_generate_snapshots_and_idempotent_submission；test_p6_acceptance.py::test_deleted_snapshot_reuse_reports_invalid_item；collections.spec.ts` | 通过（工程） | 无 |
| A-15 | 收藏不自动记录穿着 | `collections.spec.ts` | 通过（工程） | 无 |
| A-16 | 补记昨天、修改/删除不改快照 | `test_collections.py::test_wear_dates_dedup_versions_and_favorite_name；collections.spec.ts` | 通过（工程） | 无 |
| A-17 | 定位失败可手动继续 | `profile.spec.ts 定位失败注入` | 工程通过；外部待补 | 用户手机反馈通过；精确设备/场景信息待补 |
| A-18 | 隔离清空恢复、旧任务不重放 | `test_backups.py::test_restore_into_empty_test_business_data_and_reinstalls_missing_media；restore-isolated.scenario.ts` | 通过（工程） | 容量/存储证据见独立记录 |
| A-19 | 重复确认/生成幂等 | `test_imports.py::test_concurrent_confirmation_creates_one_garment；test_outfits.py::test_generate_snapshots_and_idempotent_submission` | 通过（工程） | 无 |
| A-20 | Fake 来源与真实未配置区分 | `test_contract.py::test_real_services_are_not_implicitly_faked；foundation.spec.ts` | 通过（工程） | 已补设置页 Fake 标识断言 |
| A-21 | worker 中断、未知调用不重发 | `test_recognition_recovery.py::test_process_exit_after_send_mark_needs_explicit_retry；test_outfits.py::test_cancel_before_commit_and_worker_interruption` | 通过（工程） | 真实子进程与租约注入分开记录 |
| A-22 | 锁定与场合冲突保留并解释 | `test_p6_acceptance.py::test_locked_occasion_conflict_is_explicit` | 通过（工程） | 已补锁定运动外套与正式场合冲突断言 |
| A-23 | 未锁定的非目标单品也保持 | `test_outfits.py::test_replace_preserves_every_non_target_and_lock_conflicts；outfits.spec.ts` | 通过（工程） | 无 |
| A-24 | 人工修改/清空/确认优先于晚到识别 | `test_recognition_calls.py::test_qwen_http_to_review_and_manual_priority；test_confirmed_during_request_cannot_change_garment；test_imports.py` | 通过（工程） | 模拟 HTTP，无真实云调用 |
| A-25 | 会话/选择/锁定/条件跨上下文恢复 | `outfits.spec.ts 两个独立浏览器上下文` | 工程通过；外部待补 | 两台真实手机证据未提供，不能由上下文替代 |
| A-26 | 同批有效/错误/版本冲突逐行处理 | `test_p6_acceptance.py::test_mixed_confirmation_is_atomic_per_row` | 通过（工程） | 已补同一请求三类结果及重放 |
| A-27 | 不同任务结果/SSE/终态和过期游标 | `test_p6_acceptance.py::test_sse_result_type_and_terminal_replay；test_jobs.py::test_expired_or_invalid_cursor_returns_actionable_error；outfits.test.tsx；generating-isolated.scenario.ts` | 通过（工程） | 三类 SSE 结果/终态重放、组件终态不订阅；浏览器注入过期游标回退只读查询 |
| A-28 | 业务提交后检查点失败不重生成 | `test_outfit_failures.py::test_business_commit_survives_failure_to_save_final_checkpoint；test_outfits.py::test_checkpoint_resume_reuses_saved_call_and_committed_result` | 通过（工程） | 无 |
| A-29 | 取消与提交只有一个终态 | `test_jobs.py::test_cancel_wins_and_success_wins_are_both_consistent；test_outfits.py::test_concurrent_generations_only_one_active` | 通过（工程） | 无 |
| A-30 | 维护屏障、坏包缺图/中断恢复 | `test_backups.py；test_backup_storage_faults.py` | 通过（工程） | 已验受控故障，不代表物理满盘/断电 |
| A-31 | 未配置可手填，非法输出有界失败 | `test_imports.py::test_failed_recognition_allows_manual_confirmation；test_outfit_failures.py::test_invalid_ids_exhaust_one_repair_without_committing` | 通过（工程） | 无 |
| A-32 | 0℃、城市隔离、过期降级 | `test_weather.py::test_cache_expiry_city_isolation_and_partial_failure；profile.spec.ts` | 通过（工程） | 真实和风已有历史证据，本轮不访问上游 |
| A-33 | 标签偏好更新、本次覆盖优先、旧快照不变 | `test_profile.py::test_manual_location_and_conditions_priority；test_imports.py::test_garment_edit_filters_tags_and_version_conflict；test_outfit_failures.py` | 通过（工程） | 工程证据；真实审美效果另计 |
| A-34 | 隐藏历史保留收藏/穿着及首页不重选 | `test_collections.py::test_hide_keeps_favorite_wear_snapshot_and_clears_reused_sessions；collections.spec.ts` | 通过（工程） | 无 |

## 尚需外部证据

2026-10-27 用户确认第一版开发完成，以下项目保留为待验证，当前暂不主动执行，也不要求立即补交材料。后续实际使用发现问题，或提供相关样例并要求补验时再处理；完整项目状态见 [DEVELOPMENT](../DEVELOPMENT.md)。

- **A-04/A-05 客户端边界**：用户修正版 Excel 的 8 件导入/确认已通过；Microsoft Excel 实际保存文件及客户端版本仍待提供。
- **A-06**：真实 HEIC 原片待提供；合成 HEIC、EXIF 测试和本地去背景不能替代真机原片。
- **A-17/A-25 设备边界**：手机使用按用户反馈通过；具体设备/系统/浏览器、双平台及跨手机证据未提供。不要求重复已经反馈通过的基本流程。
- **真实模型质量**：已有 8 张 PNG 识别和 v4 单次生成证据；软属性保守性、复杂条件、v4 局部替换和非空未拥有建议不由本轮 Fake 回归证明。追加真实调用必须另定场景与预算，本轮零真实调用。
- **容量边界**：已完成隔离合成负载和故障注入；真实大规模历史/照片、物理满盘与断电等未验范围继续引用容量记录，不扩大本轮范围。
