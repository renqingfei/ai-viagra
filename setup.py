from setuptools import setup, find_packages

setup(
    name="wanzi-mcp",
    version="1.0.0",
    packages=find_packages(),
    py_modules=["main", "config", "gui", "ws_handler"],
    install_requires=[
        "fastapi",
        "uvicorn",
        "pywebview",
        "requests",
    ],
    entry_points={
        "console_scripts": [
            "wanzi=gui:main",
        ],
    },
)
