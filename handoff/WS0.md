# WS0 CI Medic
Branch: fix/ci-test-cwd   Last commit: 2decab7   Model used: Gemini 3.8 Flash
Status: done

Done:
- backend/tests/test_m2_challenger_stress.py:265: In `test_verifier_rules_4_5_6_zero_diff_lines`, resolved `repo_root = Path(__file__).resolve().parents[2]`, passed `cwd=str(repo_root)`, and inserted `--` argument before the file path.
- backend/tests/test_m2_challenger_stress.py:276: In `test_prime_directive_zero_domain_hardcoding`, resolved `repo_root = Path(__file__).resolve().parents[2]`, passed `cwd=str(repo_root)`, and inserted `--` argument before target paths.
- Verified defect reproduction: tested with temporary violation comment `# amazon.com test violation` added to `backend/app/agent/sanitize.py`; confirmed both from `./backend` and from repo root that `test_prime_directive_zero_domain_hardcoding` reliably caught the violation with exit code 0 (`CompletedProcess(returncode=0)` -> `AssertionError`), and reverted clean without committing.
- Verified that `.github/workflows/ci.yml` requires no modification, as tests now execute seamlessly regardless of working directory (`./backend` or repo root).

Tests run:
- `cd backend && pytest tests/test_m2_challenger_stress.py -k "TestSacredRailsAndUniversalCompliance"`: 2 passed, 0 failed
- `pytest backend/tests/test_m2_challenger_stress.py -k "TestSacredRailsAndUniversalCompliance"`: 2 passed, 0 failed
- `cd backend && pytest tests/ -q`: 945 passed, 0 failed, 7 warnings in 18.99s
- `pytest backend/tests -q`: 945 passed, 0 failed, 7 warnings in 16.90s
- `npm run test:js`: 1,136 passed, 0 failed across all 27 JS/fixture suites

Next steps:
1. Merge `fix/ci-test-cwd` into `main`.
2. Hand off to WS1 (`feat/contract-v3`) to begin Wave 0 contract v3 authoring.

Requests for other workstreams:
- None.

Open questions for Raafat:
- None.
