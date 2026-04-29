"""
conftest.py — ensures the ai-engine src root is on sys.path
so tests can import services.* without installing the package.
"""
import sys
import os

# Add the ai-engine root to the path (parent of this tests/ directory)
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
