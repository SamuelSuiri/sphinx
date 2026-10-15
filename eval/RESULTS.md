# Evaluation results — 2026-10-15

These are development measurements on five small, synthetic Git repositories, not a certification of arbitrary code reviews. The source changed between the earlier runs; the model comparisons are not a controlled benchmark. No real pending checkpoint, human answer, or receipt was used. Saved model routes and output limits were not changed by these evaluations.

The latest frozen-source coverage, V19/V20, generated seven questions across all five fixtures. Twelve of fourteen generated-question verdict probes matched; no canonical probes were rerun in this coverage. Fresh styling, retry and multifile checks passed independent source review. Authorization still rejected a sufficient explanation for not naming a specific code condition. Configuration exposed an uncovered fixture input phrasing and a malformed grade that validation rejected. The result is **not an all-green semantic evaluation**, despite all 560 guarded unit/integration tests passing.

Explicit minimum acceptance criteria improved the fresh styling question, but did not establish consistently fair grading. The failed legacy styling replays remain below, as do the current authorization failure and earlier model/provider failures. No tested route is established here as reliably correct for arbitrary repositories or answers.

## Reproduce

```sh
npm ci
npm run eval -- --out /tmp/sphinx-eval-scripted.json
npm run eval -- --live --case cosmetic --probes generated \
  --model anthropic/claude-haiku-5.5 --allow-paid \
  --max-calls 10 --max-cost 0.04 --max-output-tokens 8192 \
  --delay-ms 1000 --skip-regressions --out /tmp/sphinx-eval-live-cosmetic.json
npm run eval -- --live --case retry,auth,config,multifile --probes generated \
  --model anthropic/claude-haiku-5.5 --allow-paid \
  --max-calls 35 --max-cost 0.15 --max-output-tokens 8192 \
  --delay-ms 1000 --skip-regressions --out /tmp/sphinx-eval-live-remaining.json
```

Live inference requires an existing OpenRouter key. Each invocation stops on a provider/transport failure; it does not automatically retry or change the selected model. The cost stop uses reported cost, may be exceeded by the final completed request, and blocks further requests if cost is missing. These are evaluation limits; they do not extend a product checkpoint's allowance.

The V11/V12 live measurements used the working tree based on `34bd7da9790b4110ec744256800ba1b847224303`, including uncommitted reviewer, evidence, audit, and eval changes. Pi was pinned to 1.2.0. The model-facing source loaded by V11 and V12 was the same. A separate presentation fix removed private concept labels from human questionnaires; a later transport diagnostic fix does not change model prompts. The transfer-distance fix described below was tested separately after V12 loaded its baseline. This commit alone therefore does not reproduce the worktree. The SHA-256 of the ordered path/content pairs for `src/evaluator.js`, `src/reviewer.js`, `src/pi-runtime.js`, `src/review-workspace.js`, `eval/cases.js`, `eval/harness.js`, and `eval/run.js` was `39bfce2b350afeb2f5d32bd42f6c9649e3bc9e2ad20e09e34aac7dbf33bcb39b` (UTF-8 path, NUL, file bytes, NUL for each).

## Deterministic baseline

`/tmp/sphinx-eval-scripted-final.json` passed all five fixtures and 35 verdict probes: 25 canonical probes plus 10 probes against generated questions. It made 59 scripted requests, including independent question and transfer audits. This exercises the real Pi/workspace/schema/grading pipeline with fake responses; it establishes harness behavior, not model quality. The related eval unit suite passed 14 tests. Seven selected regressions passed, covering omitted/invented evidence IDs, retained changed diffs, unread citations, native Pi compaction and explicit recovery. Earlier V11 artifacts ran only four of those regressions because a renamed evidence test no longer matched the runner's filter; the corrected final baseline retains the original artifacts.

The fixtures verify scoped CSS propagation, retry deduplication after failure, tenant isolation, environment/default precedence, and retry limits across twelve handlers. Executable source checks establish the non-CSS answers. CSS checks establish selector/markup relationships, not rendered layout. Tracked ignored files and dirty working-tree canaries were absent from every inspected outbound payload and retained evidence.

After the normalization and neutral-question wording changes, the complete guarded unit/integration suite passed 545 tests with no skips. The focused reviewer/recovery/evaluator run passed 83 tests, including recorded synthetic envelopes replayed through real Pi and immutable temporary Git repositories.

## Final-source GLM measurements

V11 used a full five-case run with `--max-calls 100 --max-cost 0.25 --max-output-tokens 8192 --delay-ms 3000`. A transport failure stopped it before authorization assessment generation. V12 was a separately authorized run of the remaining cases using the same limits and `--case auth,config,multifile`; this was not an automatic retry. Both used `z-ai/glm-5.3-flash`, with the output allowance including reasoning.

| Case / run | Questions | Assessment requests | Canonical verdict probes | Generated verdict probes | Total requests | Reported USD |
|---|---:|---:|---:|---:|---:|---:|
| Scoped styling / V11 | 1 | 3 | 5/5 | 2/2 | 14 | 0.023045310 |
| Retry deduplication / V11 | 1 | 4 | 5/5 | 2/2 | 15 | 0.020155650 |
| Authorization / V11 | none | 1 failed | unrun | unrun | 1 | missing |
| Authorization / V12 | 2 | 3 | 5/5 | 4/4 | 17 | 0.026317280 |
| Configuration / V12 | 1 | 3 | 5/5 | 2/2 | 14 | 0.016660060 |
| Twelve handlers / V12 | 3 | 8 | 5/5 | 5/6 | 25 | 0.037822720 |

Assessment requests include investigation, synthesis and the independent assessment audit. Total requests also include grading and a fresh audit for every proposed replacement question. Workspace reads are local operations and are not model requests. Verdict probe counts are separate from manual question-quality review.

Across the completed five-fixture coverage, eight generated questions received 16 generated-question probes; 15 completed as expected and one failed validation. All 25 canonical verdict probes matched. V11 plus V12 used 21 successful assessment requests, one failed assessment request, and 86 total requests: $0.124001020 reported, with cost telemetry for 85 requests. No live compaction occurred in these cases; compaction coverage is deterministic.

Manual review accepted the styling question's propagation boundary and the authorization questions' tenant boundary and indistinguishable denial/missing responses. Their automatic concept-coverage flags were vocabulary false positives; raw flags were retained. The retry questions and audited replacement keys were source-correct. One rubric mentioned process restart although the visible question did not ask it. A separate, independently written minimal-answer probe omitted restart information and was accepted as correct: one request, $0.000912350, no replacement question.

Known limitations remain: one styling feedback sentence was incomplete despite a complete structured response; an authorization replacement mostly renamed the original scenario rather than testing substantially different application of the concept. The configuration question correctly tested default/override precedence, but its wording gave away that the override was unaffected. Its wrong-answer replacements tested a useful new boundary: a set-but-empty value becomes zero instead of using the default. Passing these verdict probes does not prove grading fairness for all shorter answers, semantic correctness of every future audit, or sufficiently distinct transfer questions.

The multifile failure was retained, not converted to a pass. The independent replacement audit changed a valid ID to `permanent-id?`, which the existing validator rejected before accepting the grade or replacement. Manual inspection found a second defect in that rejected candidate: it described `await run()` without the operation argument required by the inspected handler, yet predicted three side effects from that operation. A deterministic reproduction gives zero counter increments and a `TypeError`; the audit missed the incomplete call. Its claim of no measurable delay also exceeded the source's narrower guarantee of no intentional backoff. The main exhaustion question's lack of an explicit causal-explanation request remains a quality flag. Thus the final live matrix is not all green, even though the accepted source keys and 40 completed verdict checks were consistent with the fixtures.

V11's authorization request returned HTTP 200 headers but no parsed completion or cost telemetry after approximately 180 seconds. Sphinx failed closed and issued no receipt. A deterministic aborted-body reproduction confirmed that the old transport diagnostic classified its own deadline as invalid/oversized JSON; the missing completion is not evidence of a semantic model failure. No timeout was extended for the next run.

## Focused transfer-distance follow-up

The label-only authorization transfer exposed missing input to its audit: the audit did not receive the previous public question. A narrow change now supplies that question and asks for a changed condition, ordering, boundary or prediction rather than renamed labels. This was evaluated separately; the V12 process continued using its already-loaded baseline.

Two authorized audit-only replay requests used the saved synthetic authorization evidence and candidate. At 8192 tokens, the first exhausted its output allowance, including 7675 reasoning tokens. At 16384, the second produced a source-correct new unauthenticated-caller scenario, but changed the private concept string and was rejected by the existing exact-concept validator. Neither replay produced an accepted product result. Together they cost $0.008992400; the second report's usage is cumulative and must not be added to the first. These observations support neither a claim that 8192 prevents truncation nor a claim that the transfer-distance fix passed a complete live flow.

Afterward, the output schema constrained the replacement's private concept to its existing value, matching the validator. The ID schema likewise now advertises its existing 1–80 character and allowed-character rules. Guarded evaluator/eval tests passed 45 cases. These schema fixes do not establish that the missed operation argument was semantically repaired.

## Bounded Haiku compatibility comparison

The rejected multifile key motivated one separate comparison, without changing the fixture or oracle:

```sh
npm run eval -- --live --case multifile \
  --model anthropic/claude-haiku-5.5 --allow-paid --max-calls 35 \
  --max-cost 0.10 --max-output-tokens 8192 --delay-ms 3000 \
  --out /tmp/sphinx-eval-live-multifile-haiku-v13.json
```

OpenRouter rejected the first request with HTTP 404 because no endpoint supported the requested `tool_choice` value. No assessment or grading ran; no cost was reported, and Sphinx did not retry. This is evidence of route incompatibility for this request, not evidence about Haiku's question quality. The process loaded the concept constraint but started before the ID schema parity change. Its same-files source fingerprint was `d133d4d15db043ee66effb38fa46f9d0413d1308997b8fc9f9f27f23d045de76`.

After the transport used Anthropic's supported automatic tool selection while retaining Sphinx's local final-tool enforcement, a separately authorized five-case V14 run used the same model, 8192 output tokens, a 100-request/$0.15 stop, and 1000ms spacing:

```sh
npm run eval -- --live --model anthropic/claude-haiku-5.5 --allow-paid \
  --max-calls 100 --max-cost 0.15 --max-output-tokens 8192 \
  --delay-ms 1000 --out /tmp/sphinx-eval-live-matrix-haiku-v14.json
```

| V14 case | Assessment requests | Accepted questions | Verdict probes | Total requests |
|---|---:|---:|---:|---:|
| Scoped styling | 4, failed | none | unrun | 4 |
| Retry deduplication | 4, failed | none | unrun | 4 |
| Authorization | 6 | 1 | 7/7 | 17 |
| Configuration | 4, failed | none | unrun | 4 |
| Twelve handlers | 5 | 2 | 9/9 | 19 |

All 48 responses explicitly reported zero cost; this records that run's telemetry and does not establish free model pricing. The 16 verdict probes comprise ten canonical and six generated probes. Independent inspection found all three accepted main keys and nine accepted replacement keys source-correct, including the missing-tenant-field boundary and retry exhaustion/recovery. Auth's prompt was somewhat leading; the unaccepted styling/configuration candidates also supplied part of their answers. One multifile replacement overlapped a different initial question. Those quality limitations remain separate from the successful verdict counts.

The three smaller cases failed on response shape before their audits: their first finish payload placed `summary` inside the `assessment` object rather than beside it. Subsequent repair attempts emitted malformed JSON strings and exhausted the bounded review allowance. A lossless normalizer was added afterward for both transports: it decodes only valid JSON-object strings and moves known metadata only when the outer field is absent. It preserves question/evidence values, unknown fields, conflicting metadata and raw native continuation; strict validation still rejects bad JSON and unread citations. Recorded first-payload fixtures exercise this fix without another live request. V14 remains failed and was not rewritten as a pass.

V14's source sidecar is `sphinx-eval-live-matrix-haiku-v14-source.json`; it adds `src/openrouter.js` to the ordered fingerprint inputs listed above. Its fingerprint is `0037ff2cfb1ac5e7cae8e05976dc43ec154dba0ba04f6bf25396c95a07d8cdf2`. The normalization change was not loaded in this run.

## Post-normalization Haiku matrix

V15 repeated the full V14 command with output `/tmp/sphinx-eval-live-matrix-haiku-v15.json`, after lossless finish-envelope normalization and neutral-question wording. Model-facing source was frozen throughout the run. The ordered source fingerprint added `src/reviewer-response.js` and was `d803245a77cdbcacc240df9fd016b42b81c4c382c2dea81dbe210752a5449224`; the full path/hash list is in the corresponding `-source.json` sidecar.

| V15 case | Assessment requests | Questions | Canonical verdict probes | Generated verdict probes | Total requests |
|---|---:|---:|---:|---:|---:|
| Scoped styling | 3 | 1 | 5/5 | 1/2 | 15 |
| Retry deduplication | 3 | 1 | 5/5 | 2/2 | 14 |
| Authorization | 2 | 2 | 4/5 | 3/4 | 15 |
| Configuration | 3 | 1 | 3/5 | 2/2 | 16 |
| Twelve handlers | 4 | 2 | 5/5 | 3/4 | 18 |

All five assessments were accepted, using 15 assessment requests. The complete run used 78 requests; all 78 explicitly reported zero cost. There was no provider failure, truncation, or automatic route change. Seven deterministic regressions also passed. This is **not** an all-green quality result: 33 of 39 verdict probes matched, and manual inspection found problems beyond verdict counts.

The styling question copied CSS and markup into a numeric-padding question and required exact pixels and specificity notation. Its key was source-correct, but it rejected the correct qualitative explanation of affected card controls and unchanged toolbar controls. Four of its five replacements repeated this numeric focus. This violates the intended behavioral-understanding scope; adding “why” to property arithmetic does not fix it.

Authorization had two product failures: a correct equivalent explanation of the shared bodyless 404 response was withheld for not naming the literal combined `if`; and a corrected invalid-key replacement repeated the original prompt, so novelty validation rejected it before the source auditor could rewrite it. The replacement already had a fresh ID, so changing IDs would not repair the issue. The other authorization question asked whether lookup occurred for an unauthenticated caller; the broad fixture answer omitted that ordering but was nevertheless accepted. This is a separate false positive and probe-coverage weakness, not a reason to accept incomplete predictions.

Two configuration failures were **fixture evidence defects**: canonical grading supplied only HEAD bodies, while its precommitted key claimed the default had increased. The source-correct generated question and both generated probes passed. The question still tested a narrower default/fallback case than the more useful default-versus-override comparison. The multifile generated failure was also a **probe-coverage gap**: the question asked for a second-call successful return, while the fixed answer described the cap and generic return-on-success without explicitly predicting that scenario. Withholding a pass was defensible. Its wrong-answer feedback did incorrectly say “exactly three” attempts while discussing a scenario that succeeds on the second; the incorrect verdict itself was justified.

Independent review found all seven accepted main keys and 24 accepted replacement keys source-correct. Retry behavior was consistently graded; one replacement omitted an explicit request for the reason, although the questionnaire's shared instructions request it. These findings do not erase the styling and grading failures.

After the frozen run, the harness was corrected to include actual filtered immutable diffs alongside HEAD dependencies for canonical probes. Source-executed fixture checks now establish unauthenticated early return before lookup and a transient retry resolving with the successful second result. The revised probes do not derive answers from model keys. Sixteen guarded eval tests passed; the V15 report remains unchanged. Focused product fixes and follow-up measurements are reported separately rather than relabeling V15.

## Focused Haiku follow-up

V16 replayed the exact saved styling candidate through the production assessment audit, then graded the same qualitative correct answer and misconception. It also checked equivalent authorization reasoning, complete and omitted lookup ordering, an invalid-key replacement, configuration probes with actual diff evidence, and transient retry probes with the independently completed answer. A scripted investigator supplied the saved candidate; its two turns were not live requests. The captured provisional invalid-key grade was likewise replayed, with only its existing source audit live. All other grading was live on fresh isolated immutable fixtures.

Ten of eleven focused checks passed using 15 actual requests, each explicitly reporting zero cost. Summed check duration was 107 seconds. The 11 checks include one assessment audit and ten grading/replacement checks; they are not eleven independently generated assessments. The source fingerprint was `6993ace15095bdd328d3c95ec8e82f8ce6ea5d2a1bbed602ac59282f90223f8c`.

The audit removed numeric arithmetic from the styling question, but Haiku still withheld a pass from the sufficient answer: “new padding” on card buttons plus unchanged horizontal padding establishes a vertical change, and the answer gave the ancestor cause and unchanged toolbar boundary. Its redundant clarification transfer was rejected by the audit. This is a remaining semantic false negative, not a successful fairness check; the conditional fresh styling-generation run was not launched.

Authorization's equivalent explanation was accepted, a complete early-return explanation passed, and omission of the explicitly requested ordering remained ambiguous. The invalid-key replacement reached the existing audit, which rewrote it into a source-correct base/head comparison; the verdict stayed ambiguous. Both configuration and transient retry checks passed. Their audited replacements were source-correct and distinct. A retry citation reason still loosely described the attempt cap as exactly three; the feedback itself correctly discussed the second-call success.

An initial temporary replay-wrapper mistake bound rebuilt source observations to the old synthetic snapshot ID. Eight remaining probes failed locally before any requests; the untouched initial artifact retains those zero-call errors. The corrected wrapper continued only the unrun probes and carried forward all five already-used styling requests. `/tmp/sphinx-eval-focused-haiku-v16.json` is cumulative and must not be added to its `-initial.json` artifact. This correction did not retry a model request or erase the styling failure.

After this measurement, an optional replacement rejected by an insufficient-evidence audit no longer turns an ambiguous grade into a provider-style failure: it keeps the original question pending with clarification feedback. Incorrect answers still require an audited transfer; provider, cancellation, context and malformed-output errors still propagate. This recovery change has deterministic coverage and does not make the false-negative answer correct. The revised scripted baseline passed five fixtures, 35 verdict probes and seven regressions with 59 fake requests; the full guarded suite before that final recovery change passed 550 tests.

## Stronger-model fairness falsification

V17 used `anthropic/claude-sonnet-5.5` with the exact saved V16 qualitative styling question, key and unchanged sufficient answer. It did not first rewrite the question to an easier one. The model returned ambiguous, requiring explicit vertical-change wording and higher-specificity terminology despite the answer establishing new card padding, unchanged horizontal padding, the ancestor scope and unchanged toolbar. This reproduced the material false negative.

The predetermined stop condition ended the comparison after that first request: 4.6 seconds, one explicitly reported zero-cost response. The planned misconception, authorization and five-fixture generation checks were **not run**. This provides no evidence that Sonnet passes the broader matrix or that increasing model cost solves the grading-design problem. The report is `/tmp/sphinx-eval-focused-sonnet-v17.json`, with source fingerprint `413f07e509a00922375faf3176aee438ce01ed8ba5dbc7b96af71643a0c3ceae`. No further route comparison followed this result.

## Explicit minimum-criteria replay

The next change separates private minimum acceptance into `acceptance.prediction` and `acceptance.causalReason`. New questions and replacement audits must produce both; fuller `expectedAnswer` and `rationale` remain independently source-checked explanations, not extra pass requirements. Grading receives those explanations in a separate `sourceKey`. Existing questions remain readable. Curated eval criteria were authored from source without changing human probes, and 17 eval tests passed. The scripted acceptance baseline passed all five fixtures and 35 verdict probes using 59 fake requests.

V18 source-audited the exact legacy V16 question through the same audit wrapper used by production generation. The audit added source-correct criteria without requiring specificity terminology. Haiku then still marked the unchanged sufficient answer ambiguous for not explicitly saying “vertical”, despite new card padding plus unchanged horizontal padding establishing that result. The criteria separation therefore has structural test coverage but **did not pass this live fairness regression**.

The run stopped after two requests and 21.5 seconds, both with explicit zero-cost telemetry. No misconception, fresh styling generation or remaining-case matrix ran because their prerequisite failed. The report is `/tmp/sphinx-eval-acceptance-haiku-v18.json`; source fingerprint `9bbcff04e1281c1178ce44f14def6f2c7e26b739abd632489060009cf7b65eaf`. The ambiguous/null result leaves the checkpoint pending and grants no approval; safe noncompletion is separate from fair grading.

## Fresh generation with minimum criteria

V19 separately tested fresh styling generation, rather than auditing the old compound candidate again. It used the first live command above. After independent review accepted that case, V20 used the second command for the four remaining fixtures. Both used `anthropic/claude-haiku-5.5`, 8192 output tokens and the same frozen source. No models, prompts or human probes changed between them. The assessment policy now includes contract version 3, so production questions and receipts prepared under the earlier contract are not silently reused.

| Case / run | Questions | Assessment requests | Generated verdict probes | Total requests |
|---|---:|---:|---:|---:|
| Scoped styling / V19 | 1 | 3 | 2/2 | 6 |
| Retry deduplication / V20 | 1 | 3 | 2/2 | 6 |
| Authorization / V20 | 2 | 3 | 3/4 | 9 |
| Configuration / V20 | 1 | 3 | 1/2 | 6 |
| Twelve handlers / V20 | 2 | 4 | 4/4 | 10 |

The two runs used 37 actual requests: 16 for assessments, 14 for grading and seven for replacement audits. All 37 explicitly reported zero cost; that is provider telemetry, not a claim that the route is free. V19 took 40.1 seconds and V20 took 241.3 seconds. There was no provider failure, truncation, live compaction or automatic retry. The source fingerprint adds `src/config.js` to the nine V15 inputs and is `d7d13eeafc213420d9f2d999c11a98751613e015eb5556a826920e98eb514661`. Corresponding source sidecars retain each file hash.

Fresh styling tested one propagation boundary: which of a card button and a toolbar button receives the changed vertical padding, and why. Its minimum criteria required the affected/unchanged surfaces and the card ancestor relationship, without numeric padding, specificity notation or an extra horizontal-axis checklist. The same unchanged qualitative answer rejected in V18 was accepted; the global-class misconception was rejected. The audited transfer placed a card inside a toolbar and correctly tested the resulting ancestor match. This is evidence for that fresh question, not a successful replay of V18.

The authorization failure is a current product false negative. The answer explained that another tenant gets a bodyless 404 “just like a missing id,” establishing the requested response equivalence. Grading still demanded an explicit “no” and the literal combined-condition mechanism. The source-audited acceptance criteria themselves unnecessarily named a single combined condition. Both question keys and accepted replacements were source-correct; source correctness did not make that sufficient answer fairly graded.

The configuration question used “BATCH_SIZE is set to 5.” The independently authored probe adapter recognized `BATCH_SIZE=number` but not this phrasing, and supplied its original example with 7. That is an uncovered scenario, so this result does not establish how the model would grade a sufficient answer to the stated input. Separately, the raw response called the omitted scenario prediction ambiguous and acknowledged no material misconception, yet emitted `incorrect` with no required transfer. Strict validation rejected that malformed result. The report remains failed; neither failure was relabeled as a pass or rerun with a tailored answer. The wrong-precedence probe was rejected correctly, and its unset-environment transfer was source-correct.

After the frozen run, the fixture adapter was extended to parse the visible “is set to” numeric assignment and mark other detected unsupported assignment forms uncovered. It still uses only the independently implemented numeric precedence rule, never a model key or criterion. This is a fixture correction with no further live measurement; V20's source fingerprint, answers and failure remain unchanged.

Retry and multifile predictions, minimum criteria and accepted replacement keys were independently checked against source. The retry transfer changes failure to success and tests the duplicate call's uncached `undefined` return. Multifile checks cover second-call success and final rejection after three total attempts; replacements test an unreachable fourth-call success and a hypothetical limit of two. The latter is a modest parameter-change transfer, but its count affects actual retry behavior. All seven accepted main keys and seven accepted replacement keys in V19/V20 were source-correct on manual review. Styling, authorization-denial and multifile-final-failure keyword flags were vocabulary false positives; their raw flags remain.

This coverage is generated-only. Earlier canonical results are retained under their original source versions, and no complete canonical matrix was rerun after contract version 3. The latest scripted acceptance baseline passed five fixtures, 35 verdict probes and seven selected regressions using 59 fake requests; eval unit tests passed 17 cases. The final guarded suite passed 560 tests with no skips. Those deterministic checks verify implementation behavior and privacy boundaries; they do not override the live semantic failures.

## Earlier failures were retained

| Run | Model | Requests | Reported USD | Observations |
|---|---|---:|---:|---|
| Initial cosmetic iterations | Qwen Coder/Next and DeepSeek | 21 | 0.011807669 | Contradictory selector key, unsupported-premise false pass, weak numeric questions, rejected audits, and 429s. |
| V4 | DeepSeek V3.2 | 50 | 0.073801164 | Invalid-key grading and feedback failures; run-wide allowance left the final case untested. |
| V5 | DeepSeek V3.2 | 17 | 0.022592460 | Cosmetic numeric recall and an audit that confused distinct retry branches. |
| V6 | Qwen3 Coder Next | 5 | 0.002084040 | Provider 429; no successful matrix. |
| V7 | DeepSeek V3.2 | 9 | 0.014308000 | Investigation/finalization exhausted the normal review ceiling. |
| V8 | DeepSeek V3.2 | 26 | 0.016196685 | Valid questions were marked ambiguous when the human answer was wrong; contradictory retry key. Stopped after two cases. |
| V9 | Qwen3 Coder | 48 | 0.035690180 | Weak/redundant authorization questions despite 11/11 verdicts; wrong answers sometimes invalidated sound keys; final case timed out. |
| V10 | GLM 5.3 Flash, 4096 tokens | 25 | 0.033687670 | Two cases had 7/7 verdicts each, but manual review found a replacement key that omitted a possible callback throw. Authorization audit hit the output cap, including 3736 reasoning tokens. |

The V9 generated configuration question used `BATCH_SIZE=15` while its original fixed probe answered `=7`. That mismatch was a fixture coverage defect, not proven bad grading. Subsequent probes derive explicit numeric inputs from the visible question and the independently implemented loader rule, never from a model's answer key. The separate V9 canonical wrong-answer-to-ambiguous failure remains a product failure.

The observed defects led to bounded source inventory/diff seeding, a single repair window within the existing allowance, source-constrained citations, source-first question-validity grading, and independent audits of replacement questions. These fixes did not retroactively change earlier results. No model's assertion that its own question is good was used as the quality oracle.

## Artifacts and accounting

Raw reports remain local under `/tmp`, not in the repository. They contain only synthetic source, questions and rubrics, and sanitized diagnostics; no credentials. The two confirmed sufficient-answer failures from V18 and V20 are also retained in [a small regression fixture](fixtures/known-false-negatives.json), including exact source definitions, question criteria, answers and provenance. Main reports are `sphinx-eval-scripted-final.json`, `sphinx-eval-live-matrix-glm-v11.json`, `sphinx-eval-live-remaining-glm-v12.json`, and `sphinx-eval-retry-fairness-v11.json`. The focused audit reports are `sphinx-eval-auth-transfer-replay-v12.json` and `sphinx-eval-auth-transfer-replay-16384-v12.json`; the compatibility comparison is `sphinx-eval-live-multifile-haiku-v13.json`. Earlier comparisons use `sphinx-eval-live-matrix-deepseek-v4.json`, `sphinx-eval-live-small-deepseek-v5.json`, `sphinx-eval-live-matrix-qwen-v6.json`, `sphinx-eval-live-small-deepseek-v7.json`, `sphinx-eval-live-matrix-deepseek-v8.json`, `sphinx-eval-live-matrix-qwen-coder-v9.json`, and `sphinx-eval-live-matrix-glm-v10.json`. The initial cosmetic reports are `sphinx-eval-live-cosmetic.json`, `sphinx-eval-live-cosmetic-v2.json`, `sphinx-eval-live-cosmetic-v3.json`, `sphinx-eval-live-cosmetic-qwen-coder.json`, and `sphinx-eval-live-cosmetic-deepseek.json`.

The latest reports are `sphinx-eval-live-cosmetic-haiku-v19.json` and `sphinx-eval-live-remaining-haiku-v20.json`, with matching `-source.json` sidecars. The acceptance baseline is `sphinx-eval-scripted-acceptance.json`. Focused reports V16–V18 remain `sphinx-eval-focused-haiku-v16.json`, `sphinx-eval-focused-sonnet-v17.json` and `sphinx-eval-acceptance-haiku-v18.json`; V15 is `sphinx-eval-live-matrix-haiku-v15.json`.

All listed exploratory live runs through V20, the fairness probe and the two audit replays total **472 actual requests and $0.344073638 reported**, with cost telemetry for 465 requests and seven missing reports. The V12 remaining-case run alone used 56 requests and $0.080800060, all reported. Missing telemetry is not assumed to mean a free request; reported totals are not a billing reconciliation. Scripted requests are excluded from these totals.
