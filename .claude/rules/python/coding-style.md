# Python — coding style

Mechanical rules are enforced by the lint command at gate G1.

- One module, one job. No catch-all `utils.py` that grows forever.
- Type hints on public functions.
- No `from module import *`.
- Fail loudly. Do not swallow exceptions.
