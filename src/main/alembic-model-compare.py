import contextlib
import importlib.util
import io
import json
import os
import sys
from pathlib import Path


def emit(value):
    sys.stdout.write("\n__ROWFISH_RESULT__" + json.dumps(value, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def describe_operation(operation):
    name = type(operation).__name__
    schema = getattr(operation, "schema", None)
    table = getattr(operation, "table_name", None)
    qualified_table = ".".join(part for part in (schema, table) if part)
    if name == "CreateTableOp":
        columns = [
            column.name
            for column in getattr(operation, "columns", [])
            if isinstance(getattr(column, "name", None), str)
        ]
        suffix = f" ({', '.join(columns)})" if columns else ""
        return {"kind": "create-table", "description": f"Create table {qualified_table}{suffix}"}
    if name == "DropTableOp":
        return {"kind": "drop-table", "description": f"Drop table {qualified_table}"}
    if name == "CreateIndexOp":
        return {
            "kind": "create-index",
            "description": f"Create index {operation.index_name} on {qualified_table}",
        }
    if name == "DropIndexOp":
        return {
            "kind": "drop-index",
            "description": f"Drop index {operation.index_name} on {qualified_table}",
        }
    if name == "AddColumnOp":
        return {
            "kind": "add-column",
            "description": f"Add column {operation.column.name} to {qualified_table}",
        }
    if name == "DropColumnOp":
        return {
            "kind": "drop-column",
            "description": f"Drop column {operation.column_name} from {qualified_table}",
        }
    if name == "AlterColumnOp":
        return {
            "kind": "alter-column",
            "description": f"Alter column {operation.column_name} on {qualified_table}",
        }
    constraint = getattr(operation, "constraint_name", None)
    if constraint:
        return {
            "kind": name.removesuffix("Op").replace("_", "-").lower(),
            "description": f"{name.removesuffix('Op').replace('Constraint', ' constraint').replace('Index', ' index')} {constraint} on {qualified_table}",
        }
    return {
        "kind": name.removesuffix("Op").replace("_", "-").lower(),
        "description": f"Review {name.removesuffix('Op')} on {qualified_table or 'the database'}",
    }


def flatten_operations(operation_group):
    children = getattr(operation_group, "ops", None)
    if children is not None:
        for child in children:
            yield from flatten_operations(child)
    else:
        yield operation_group


def build_connection_url(connection):
    from sqlalchemy.engine import URL

    driver = "psycopg" if importlib.util.find_spec("psycopg") else "psycopg2"
    if not importlib.util.find_spec(driver):
        raise RuntimeError(
            "The selected Python environment needs SQLAlchemy and either psycopg or psycopg2 installed."
        )
    query = {
        "options": "-c default_transaction_read_only=on",
        "sslmode": connection.get("sslMode") or ("verify-full" if connection.get("tls") else "prefer"),
    }
    return URL.create(
        drivername=f"postgresql+{driver}",
        username=connection.get("username") or None,
        password=connection.get("password") or None,
        host=connection.get("host"),
        port=connection.get("port"),
        database=connection.get("database"),
        query=query,
    )


def run(payload):
    from alembic.autogenerate import produce_migrations
    from alembic.config import Config
    from alembic.operations import Operations
    from alembic.runtime.environment import EnvironmentContext
    from alembic.script import ScriptDirectory
    from sqlalchemy import __version__ as sqlalchemy_version
    from alembic.runtime.migration import MigrationContext

    config_path = Path(payload["configPath"]).resolve(strict=True)
    if not config_path.is_file():
        raise RuntimeError("Choose an Alembic configuration file.")
    database_url = build_connection_url(payload["connection"])
    url_text = database_url.render_as_string(hide_password=False)
    config = Config(str(config_path))
    config.set_main_option("sqlalchemy.url", url_text.replace("%", "%%"))
    config.attributes["rowfish_read_only_compare"] = True
    # Common application settings are set to the selected Rowfish connection;
    # project-specific code can still have side effects, so the UI warns first.
    os.environ["DATABASE_URL"] = url_text
    os.environ["SQLALCHEMY_DATABASE_URI"] = url_text
    os.environ["ROWFISH_READ_ONLY_COMPARE"] = "1"

    script = ScriptDirectory.from_config(config)
    captured = {}

    def compare_only(_revision, migration_context):
        metadata = migration_context.opts.get("target_metadata")
        if metadata is None:
            raise RuntimeError(
                "Alembic env.py did not expose target_metadata; configure SQLAlchemy model metadata in the selected Alembic environment."
            )
        if isinstance(metadata, (list, tuple)) and not metadata:
            raise RuntimeError("Alembic target_metadata contains no metadata objects.")
        migration_script = produce_migrations(migration_context, metadata)
        operation_objects = list(flatten_operations(migration_script.upgrade_ops))
        sql_preview = ""
        diagnostics = []
        if operation_objects:
            try:
                output = io.StringIO()
                offline_context = MigrationContext.configure(
                    dialect=migration_context.dialect,
                    opts={"as_sql": True, "output_buffer": output},
                )
                offline_operations = Operations(offline_context)
                for operation in operation_objects:
                    offline_operations.invoke(operation)
                sql_preview = output.getvalue()
            except Exception as error:
                diagnostics.append(
                    "Differences were found, but SQL could not be rendered for every operation: "
                    + str(error)
                )
        captured.update(
            {
                "operations": [describe_operation(operation) for operation in operation_objects],
                "sqlPreview": sql_preview,
                "diagnostics": diagnostics,
                "alembicVersion": __import__("alembic").__version__,
                "sqlalchemyVersion": sqlalchemy_version,
            }
        )
        # Returning no migration steps is essential: this command never applies upgrades.
        return []

    environment = EnvironmentContext(config, script)
    # Intercept env.py before Alembic reads/creates alembic_version or dispatches
    # any revision functions. Only the autogenerate comparison runs.
    environment.run_migrations = lambda **_kwargs: compare_only(
        None, environment.get_context()
    )
    with contextlib.redirect_stdout(sys.stderr):
        with environment:
            script.run_env()
    if not captured:
        raise RuntimeError(
            "The selected Alembic env.py did not call context.run_migrations(); Rowfish could not capture target_metadata."
        )
    return {"ok": True, **captured}


def main():
    payload = json.load(sys.stdin)
    secret = payload.get("connection", {}).get("password") or ""
    try:
        result = run(payload)
        emit(result)
    except Exception as error:
        message = str(error)
        if secret:
            message = message.replace(secret, "[redacted]")
        emit({"ok": False, "error": message[:2000]})
        raise SystemExit(1)


if __name__ == "__main__":
    main()
