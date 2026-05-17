"""
Recode-IT backend — Phase 3.

Auth (signup/login/recovery + JWT in HttpOnly cookie) and zero-knowledge
encrypted-mapping persistence. Architecturally additive to MHC-L's
mcp_server.* modules but lives in its own package so deploy is a clean,
separately-versioned drop-in. See ../IMPLEMENTATION_PLAN.md §"Phase 3".
"""

__version__ = "0.3.0-phase3"
