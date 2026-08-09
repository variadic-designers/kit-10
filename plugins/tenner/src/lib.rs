use base64::Engine;
use extism_pdk::*;
use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};

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
// exact class of bug AGENTS.md's Common Pitfalls warns about for structs that DO need to
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

// Mirrors ImportProjectInput's shape exactly, but `data_base64` carries the SAME bytes
// export_project_gz's own `data_base64` returns (gzip-then-base64), not plain YAML text -- see
// import_project_gz below. A separate struct rather than an `Option<String>` alternative field on
// ImportProjectInput itself, since the plain/compressed import paths are two distinct manifest
// entries (`import_project`/`import_project_gz`, plugins-bootstrap.ts's TENNER_MANIFEST) with two
// distinct `accept` filters (.yaml,.yml vs .gz) -- there's never a call site that needs to send
// either field to the same function.
#[derive(Debug, Clone, Deserialize, Default)]
struct ImportProjectGzInput {
    workspace_id: String,
    data_base64: String,
}

#[plugin_fn]
pub fn on_init(_input: String) -> FnResult<String> {
    Ok("ok".to_string())
}

// Shared by export_project/export_project_gz: fetches the project's full data dump via the host
// (kit10_get_project_export, wrapping Manager's existing exportProject). Kept separate from YAML
// serialization so the gzip variant can compress the exact same bytes the plain variant would have
// written, rather than re-deriving them differently.
fn fetch_export_data(project_id: String) -> FnResult<serde_json::Value> {
    let result = unsafe {
        kit10_get_project_export(GetProjectExportInput { project_id })?
    };

    if !result.success {
        return Err(Error::msg(
            result.error.unwrap_or_else(|| "project export failed".to_string()),
        )
        .into());
    }

    result
        .data
        .ok_or_else(|| Error::msg("project export returned no data").into())
}

// Shared by import_project/import_project_gz: hands an already-parsed data blob to the host
// (kit10_import_project_data, wrapping Manager's existing importProjectData) to write as a
// brand-new project. Tenner never touches the DB or generates any ids itself. Returns the new
// project's {id, name} as JSON.
fn import_export_data(workspace_id: String, data: serde_json::Value) -> FnResult<String> {
    let result = unsafe {
        kit10_import_project_data(ImportProjectDataInput { workspace_id, data })?
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

/// Pulls a project's full data dump and serializes it as plain YAML text. No zip, no binary
/// handling -- this is a plain preservation format, not a conversion to some other design-tool
/// shape. See export_project_gz for the compressed counterpart.
#[plugin_fn]
pub fn export_project(input: String) -> FnResult<String> {
    let req: ExportProjectInput = serde_json::from_str(&input)?;
    let data = fetch_export_data(req.project_id)?;
    Ok(serde_yaml_ng::to_string(&data)?)
}

/// Same data as export_project, gzip-compressed then base64-encoded into the returned string --
/// Extism plugin_fn results here are String-typed (see GetProjectExportResult's own doc comment),
/// so real binary bytes have to travel as base64 text rather than a raw byte return; the host
/// (download.ts) decodes this back to bytes before writing the actual `.yaml.gz` file, the same
/// base64-string-carrying-binary convention Charter's `viewport_data_binary` field already uses.
/// The underlying data is exactly as repetitive/normalized as a raw DB dump gets (small enum
/// strings and ids repeated across many rows), which is exactly what a general-purpose compressor
/// exploits well -- no format redesign needed, just gzip the existing YAML bytes.
#[plugin_fn]
pub fn export_project_gz(input: String) -> FnResult<String> {
    let req: ExportProjectInput = serde_json::from_str(&input)?;
    let data = fetch_export_data(req.project_id)?;
    let yaml = serde_yaml_ng::to_string(&data)?;

    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(yaml.as_bytes())?;
    let gz_bytes = encoder.finish()?;

    Ok(base64::engine::general_purpose::STANDARD.encode(gz_bytes))
}

/// Inverse of export_project: parses YAML text (the format export_project produces) back into a
/// JSON value and imports it. See import_project_gz for the compressed counterpart.
#[plugin_fn]
pub fn import_project(input: String) -> FnResult<String> {
    let req: ImportProjectInput = serde_json::from_str(&input)?;
    let data: serde_json::Value = serde_yaml_ng::from_str(&req.text)?;
    import_export_data(req.workspace_id, data)
}

/// Inverse of export_project_gz: base64-decodes and gunzips `data_base64` back into the same YAML
/// text export_project_gz compressed, then imports it exactly like import_project.
#[plugin_fn]
pub fn import_project_gz(input: String) -> FnResult<String> {
    let req: ImportProjectGzInput = serde_json::from_str(&input)?;
    let gz_bytes = base64::engine::general_purpose::STANDARD.decode(&req.data_base64)?;

    let mut yaml = String::new();
    GzDecoder::new(&gz_bytes[..]).read_to_string(&mut yaml)?;

    let data: serde_json::Value = serde_yaml_ng::from_str(&yaml)?;
    import_export_data(req.workspace_id, data)
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

    #[test]
    fn import_project_gz_input_deserializes_snake_case() {
        let input: ImportProjectGzInput =
            serde_json::from_str(r#"{"workspace_id":"ws-1","data_base64":"abc123=="}"#).unwrap();
        assert_eq!(input.workspace_id, "ws-1");
        assert_eq!(input.data_base64, "abc123==");
    }

    // Exercises the exact gzip+base64 round trip export_project_gz/import_project_gz do, without
    // going through the host-fn boundary (fetch_export_data/import_export_data need a live host,
    // out of scope for a unit test) -- proves the compression half is correct in isolation.
    #[test]
    fn gzip_base64_round_trips_back_to_the_same_yaml_text() {
        let value = serde_json::json!({
            "project": { "id": "abc", "name": "Demo" },
            "views": (0..50)
                .map(|i| serde_json::json!({ "id": format!("v{i}"), "name": "Repeated Name" }))
                .collect::<Vec<_>>()
        });
        let yaml = serde_yaml_ng::to_string(&value).unwrap();

        let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(yaml.as_bytes()).unwrap();
        let gz_bytes = encoder.finish().unwrap();
        // The whole point of gzip here is exploiting this data's own repetition -- assert it
        // actually shrinks, not just that it round-trips (a no-op "compressor" would round-trip too).
        assert!(gz_bytes.len() < yaml.len());

        let base64_str = base64::engine::general_purpose::STANDARD.encode(&gz_bytes);
        let decoded_bytes = base64::engine::general_purpose::STANDARD
            .decode(&base64_str)
            .unwrap();
        let mut roundtripped_yaml = String::new();
        GzDecoder::new(&decoded_bytes[..])
            .read_to_string(&mut roundtripped_yaml)
            .unwrap();

        assert_eq!(roundtripped_yaml, yaml);
        let parsed: serde_json::Value = serde_yaml_ng::from_str(&roundtripped_yaml).unwrap();
        assert_eq!(parsed, value);
    }
}
