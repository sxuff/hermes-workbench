"""Hermes Workbench: a browser-native session workbench for Hermes Agent.

The UI ships as a dashboard plugin (``dashboard/``). This module only adds the
``hermes workbench`` command that opens it as its own app window. It registers no
tools and no hooks, and registration itself does no I/O.
"""


def register(ctx) -> None:
    register_cli = getattr(ctx, "register_cli_command", None)
    if not callable(register_cli):
        return
    from .workbench_cli import handler, setup_parser
    register_cli(name="workbench", help="Open Hermes Workbench in your browser",
                 description="Open the Workbench as its own app window, starting the dashboard backend if needed.",
                 setup_fn=setup_parser, handler_fn=handler)
