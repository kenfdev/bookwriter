use serde::Serialize;
use std::fs;
use std::path::PathBuf;

#[derive(Serialize)]
struct DirItem {
    name: String,
    kind: String,
}

#[tauri::command]
fn read_text(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|error| error.to_string())
}

#[tauri::command]
fn write_text(path: String, text: String) -> Result<(), String> {
    if let Some(parent) = PathBuf::from(&path).parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(&path, text).map_err(|error| error.to_string())
}

#[tauri::command]
fn read_dir(path: String) -> Result<Vec<DirItem>, String> {
    let mut items = Vec::new();
    for entry in fs::read_dir(&path).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let kind = if entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false) {
            "dir"
        } else {
            "file"
        };
        items.push(DirItem {
            name,
            kind: kind.to_string(),
        });
    }
    Ok(items)
}

#[tauri::command]
fn rename_path(from: String, to: String) -> Result<(), String> {
    if let Some(parent) = PathBuf::from(&to).parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::rename(&from, &to).map_err(|error| error.to_string())
}

#[tauri::command]
fn make_dir(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|error| error.to_string())
}

fn spec_book_path() -> Option<String> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../spec-book");
    path.canonicalize()
        .ok()
        .map(|found| found.to_string_lossy().into_owned())
}

fn book_from_args() -> Result<Option<String>, String> {
    for arg in std::env::args().skip(1) {
        if arg == "--" || arg.starts_with('-') {
            continue;
        }
        let path = PathBuf::from(&arg);
        if !path.is_dir() {
            return Err(format!("not a directory: {arg}"));
        }
        let full = path.canonicalize().map_err(|error| error.to_string())?;
        return Ok(Some(full.to_string_lossy().into_owned()));
    }
    Ok(None)
}

#[tauri::command]
fn startup_book_path() -> Result<String, String> {
    if let Some(path) = book_from_args()? {
        return Ok(path);
    }
    spec_book_path().ok_or_else(|| "Open a book.".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_text,
            write_text,
            read_dir,
            rename_path,
            make_dir,
            startup_book_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running Bookwriter");
}
