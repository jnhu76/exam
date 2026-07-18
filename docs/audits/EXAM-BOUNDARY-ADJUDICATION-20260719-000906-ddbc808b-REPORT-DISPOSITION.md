# Report-Disposition Manifest
## EXAM-BOUNDARY-ADJUDICATION-20260719-000906-ddbc808b

### Which reports remain useful as evidence?
- **A-213011**: Strong first-run evidence. Good baseline. Keep.
- **A-213429**: Unique P1 finding about exam policy snapshot (partially confirmed). Keep for unique claim.
- **A-214453**: Most evolved A version. Best single A report for executive summary. Keep.
- **A-231530**: Highest reliability — executed targeted tests. Keep as authoritative A evidence.
- **B-213429**: Comprehensive first-run B evidence. Keep.
- **B-214337**: Highest reliability B report. Keep as authoritative B evidence.
- **B-222150**: Second highest B — executed targeted tests. Keep.

### Which reports are superseded?
- **FINAL-214453**: Derived merged summary. No independent evidence. Superseded by this adjudication.

### Which reports contain valid unique findings?
- **A-213429**: Exam policy snapshot gap (F-ADJ-P1-001, partially confirmed).
- **B-213429**: Proctor 403, dead route, legacy requireRole, export routes, x-role mismatch.
- **B-214453**: QuestionPage capability gating (F-ADJ-P2-004), attachment ghost (F-ADJ-P3-006).

### Which reports overclaim?
- **B-213429**: Overclassifies Proctor Dashboard 403 as P1 (reduced to P2); overclassifies proctor-incident dead route as P1 (reduced to P3).
- **A-214328 and A-231530**: Overclaim fill_blank as SUPPORTED — E2E is explicitly skipped.
- **A-213429**: P1 for exam policy snapshot may be overstated for Admin+Candidate deployment (no UI exposes runtime changes).

### Which reports are misnamed?
- **B-214453**: RUN_ID declares `EXAM-BOUNDARY-A-20260718-214453` but `AGENT_SLOT: B`. Naming is internally inconsistent. Content is valid B analysis.

### Which merged/final reports must not be treated as authority?
- **FINAL-214453**: Derived summary only. Reuses all evidence from source reports. Must not be treated as independent authority. Useful as a concise overview but this adjudication supersedes it.

| Report | Keep as evidence | Unique valid findings | Overclaims/errors | Final status |
|---|---|---|---|---|
| A-20260718-213011 | ✅ | General baseline | None significant | PRIMARY EVIDENCE |
| A-20260718-213429 | ✅ | Exam policy snapshot | P1 severity may be overstated | SUPPORTING EVIDENCE |
| A-20260718-214328 | Partial | Lightweight overview | fill_blank claimed SUPPORTED (E2E skipped) | PARTIALLY RELIABLE |
| A-20260718-214453 | ✅ | i18n gap, XSS downgrade | None significant | PRIMARY EVIDENCE |
| A-20260718-231530 | ✅ | Executed targeted tests | fill_blank claimed SUPPORTED | PRIMARY EVIDENCE |
| B-20260718-213429 | ✅ | Proctor 403, dead route, legacy gates | P1 severity overclaims | PRIMARY EVIDENCE |
| B-20260718-214337 | ✅ | Best B structure/severity | None significant | PRIMARY EVIDENCE |
| B-20260718-214453 | ✅ (with caution) | QuestionPage gating, attachments | Misnamed RUN_ID | MISNAMED BUT USABLE |
| B-20260718-222150 | ✅ | Executed targeted tests | None significant | PRIMARY EVIDENCE |
| FINAL-20260718-214453 | ❌ (as authority) | None (all derived) | No independent evidence | DERIVED SUMMARY — superseded |
