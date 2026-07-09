use extism_pdk::*;
use serde::{Deserialize, Serialize};

// JS (manager.svelte.ts's kit10_get_project_export host function) authors this JSON going
// Rust -> JS, so it just uses plain snake_case -- same convention as WriteRenderEntryInput in
// Charter, no rename_all needed since nothing on the JS side expects camelCase here.
#[derive(Debug, Clone, Serialize, Deserialize, ToBytes, FromBytes, Default)]
#[encoding(Json)]
struct GetProjectExportInput {
    project_id: String,
}

// `data` is deliberately typed as an opaque serde_json::Value rather than a matching Rust
// struct for exportProject's row shapes. Tenner doesn't need to interpret any individual
// field -- it only re-emits the same structure as YAML -- so there's nothing to keep in sync
// if Manager's exportProject shape changes, and no camelCase/snake_case mismatch risk (the
// exact class of bug CLAUDE.md's Common Pitfalls warns about for structs that DO need to
// match field-for-field).
#[derive(Debug, Clone, Serialize, Deserialize, ToBytes, FromBytes, Default)]
#[encoding(Json)]
struct GetProjectExportResult {
    success: bool,
    #[serde(default)]
    data: Option<serde_json::Value>,
    #[serde(default)]
    error: Option<String>,
}

// Mirrors GetProjectExportInput/Result's convention: JS authors this one too (going Rust -> JS,
// via kit10_import_project_data's request), so plain snake_case, no rename_all.
#[derive(Debug, Clone, Serialize, Deserialize, ToBytes, FromBytes, Default)]
#[encoding(Json)]
struct ImportProjectDataInput {
    workspace_id: String,
    data: serde_json::Value,
}

// Same reasoning as GetProjectExportResult: `project` stays an opaque serde_json::Value (just
// {id, name} in practice, but Tenner doesn't need to know that shape either) rather than a
// matching struct -- nothing to keep in sync if Manager's importProjectData return shape changes.
#[derive(Debug, Clone, Serialize, Deserialize, ToBytes, FromBytes, Default)]
#[encoding(Json)]
struct ImportProjectDataResult {
    success: bool,
    #[serde(default)]
    project: Option<serde_json::Value>,
    #[serde(default)]
    error: Option<String>,
}

#[host_fn]
extern "ExtismHost" {
    pub fn kit10_get_project_export(input: GetProjectExportInput) -> GetProjectExportResult;
    pub fn kit10_import_project_data(input: ImportProjectDataInput) -> ImportProjectDataResult;
}

#[derive(Debug, Clone, Deserialize, Default)]
struct ExportProjectInput {
    project_id: String,
}

#[derive(Debug, Clone, Deserialize, Default)]
struct ImportProjectInput {
    workspace_id: String,
    text: String,
}

#[plugin_fn]
pub fn on_init(_input: String) -> FnResult<String> {
    Ok("ok".to_string())
}

/// Pulls a project's full data dump via the host (kit10_get_project_export, which wraps
/// Manager's existing exportProject) and serializes it as YAML. No zip, no binary handling --
/// this is a plain preservation format, not a conversion to some other design-tool shape.
#[plugin_fn]
pub fn export_project(input: String) -> FnResult<String> {
    let req: ExportProjectInput = serde_json::from_str(&input)?;

    let result = unsafe {
        kit10_get_project_export(GetProjectExportInput {
            project_id: req.project_id,
        })?
    };

    if !result.success {
        return Err(Error::msg(
            result.error.unwrap_or_else(|| "project export failed".to_string()),
        )
        .into());
    }

    let data = result
        .data
        .ok_or_else(|| Error::msg("project export returned no data"))?;

    Ok(serde_yaml_ng::to_string(&data)?)
}

/// Inverse of export_project: parses YAML text (the format export_project produces) back into a
/// JSON value and hands it to the host (kit10_import_project_data, wrapping Manager's
/// importProjectData) to write as a brand-new project. Tenner never touches the DB or generates
/// any ids itself -- same boundary as export_project, just the opposite direction. Returns the
/// new project's {id, name} as JSON.
#[plugin_fn]
pub fn import_project(input: String) -> FnResult<String> {
    let req: ImportProjectInput = serde_json::from_str(&input)?;
    let data: serde_json::Value = serde_yaml_ng::from_str(&req.text)?;

    let result = unsafe {
        kit10_import_project_data(ImportProjectDataInput {
            workspace_id: req.workspace_id,
            data,
        })?
    };

    if !result.success {
        return Err(Error::msg(
            result.error.unwrap_or_else(|| "project import failed".to_string()),
        )
        .into());
    }

    let project = result
        .project
        .ok_or_else(|| Error::msg("project import returned no project"))?;

    Ok(serde_json::to_string(&project)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_arbitrary_json_to_yaml() {
        let value = serde_json::json!({
            "project": { "id": "abc", "name": "Demo" },
            "views": [{ "id": "v1", "name": "Light Default" }]
        });

        let yaml = serde_yaml_ng::to_string(&value).unwrap();
        assert!(yaml.contains("name: Demo"));
        assert!(yaml.contains("- id: v1"));
    }

    #[test]
    fn export_project_input_deserializes_snake_case() {
        let input: ExportProjectInput =
            serde_json::from_str(r#"{"project_id":"abc-123"}"#).unwrap();
        assert_eq!(input.project_id, "abc-123");
    }

    #[test]
    fn import_project_input_deserializes_snake_case() {
        let input: ImportProjectInput =
            serde_json::from_str(r#"{"workspace_id":"ws-1","text":"project:\n  id: abc\n"}"#)
                .unwrap();
        assert_eq!(input.workspace_id, "ws-1");
        assert!(input.text.contains("id: abc"));
    }

    #[test]
    fn yaml_round_trips_back_to_the_same_json_value() {
        let value = serde_json::json!({
            "project": { "id": "abc", "name": "Demo" },
            "views": [{ "id": "v1", "name": "Light Default" }],
            "tokens": []
        });

        let yaml = serde_yaml_ng::to_string(&value).unwrap();
        let parsed: serde_json::Value = serde_yaml_ng::from_str(&yaml).unwrap();
        assert_eq!(parsed, value);
    }
}
