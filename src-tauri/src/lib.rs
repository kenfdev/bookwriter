use serde::Serialize;
use std::fs;
use std::io::ErrorKind;
use std::path::PathBuf;
use tauri::Manager;

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
fn read_bytes(path: String) -> Result<tauri::ipc::Response, String> {
    fs::read(&path)
        .map(tauri::ipc::Response::new)
        .map_err(|error| error.to_string())
}

fn ensure_parent(path: &str) -> Result<(), String> {
    if let Some(parent) = PathBuf::from(path).parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn write_text(path: String, text: String) -> Result<(), String> {
    ensure_parent(&path)?;
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
    ensure_parent(&to)?;
    fs::rename(&from, &to).map_err(|error| error.to_string())
}

#[tauri::command]
fn make_dir(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|error| error.to_string())
}

#[tauri::command]
fn canonicalize_path(path: String) -> Result<String, String> {
    fs::canonicalize(&path)
        .map(|found| found.to_string_lossy().into_owned())
        .map_err(|error| error.to_string())
}

fn remove_copied_source(from: &str, to: &str) -> Result<(), String> {
    if let Err(remove_error) = fs::remove_file(from) {
        let _ = fs::remove_file(to);
        return Err(remove_error.to_string());
    }
    Ok(())
}

fn copy_then_remove(from: &str, to: &str) -> Result<(), String> {
    fs::copy(from, to).map_err(|error| error.to_string())?;
    remove_copied_source(from, to)
}

#[tauri::command]
fn move_file(from: String, to: String) -> Result<(), String> {
    ensure_parent(&to)?;
    match fs::rename(&from, &to) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == ErrorKind::CrossesDevices => copy_then_remove(&from, &to),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn allow_book(app: tauri::AppHandle, root: String) -> Result<(), String> {
    app.asset_protocol_scope()
        .allow_directory(&root, true)
        .map_err(|error| error.to_string())
}

fn spec_book_path() -> Option<String> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../spec-book");
    path.canonicalize()
        .ok()
        .map(|found| found.to_string_lossy().into_owned())
}

const USAGE: &str = include_str!("../../usage.txt");

fn book_from_args() -> Result<Option<String>, String> {
    book_from(std::env::args().skip(1))
}

fn help_requested() -> bool {
    help_flag(std::env::args().skip(1))
}

fn help_flag<I>(args: I) -> bool
where
    I: IntoIterator,
    I::Item: AsRef<str>,
{
    for arg in args {
        let arg = arg.as_ref();
        if arg == "--" {
            return false;
        }
        if is_help(arg) {
            return true;
        }
    }
    false
}

fn is_help(arg: &str) -> bool {
    arg == "--help" || arg == "-h"
}

fn book_from<I>(args: I) -> Result<Option<String>, String>
where
    I: IntoIterator,
    I::Item: AsRef<str>,
{
    for arg in args {
        let arg = arg.as_ref();
        if arg == "--" || arg.starts_with('-') {
            continue;
        }
        let path = PathBuf::from(arg);
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
    if help_requested() {
        print!("{USAGE}");
        return;
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            read_text,
            read_bytes,
            write_text,
            read_dir,
            rename_path,
            make_dir,
            canonicalize_path,
            move_file,
            allow_book,
            startup_book_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running Bookwriter");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir() -> PathBuf {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let path = std::env::temp_dir().join(format!("bookwriter-{nanos}"));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn writes_reads_and_lists_a_book_folder() {
        let dir = temp_dir();
        let file = dir.join("chapters").join("one.md");
        let path = file.to_string_lossy().into_owned();
        write_text(path.clone(), "hello".into()).unwrap();
        assert_eq!(read_text(path.clone()).unwrap(), "hello");
        read_bytes(path).unwrap();
        fs::create_dir(dir.join("pictures")).unwrap();
        let names: Vec<_> = read_dir(dir.to_string_lossy().into_owned())
            .unwrap()
            .into_iter()
            .map(|item| (item.name, item.kind))
            .collect();
        assert!(names.contains(&("chapters".into(), "dir".into())));
        assert!(names.contains(&("pictures".into(), "dir".into())));
        let chapter = read_dir(dir.join("chapters").to_string_lossy().into_owned()).unwrap();
        assert!(chapter.iter().any(|item| item.name == "one.md" && item.kind == "file"));
    }

    #[test]
    fn renames_and_moves_a_file() {
        let dir = temp_dir();
        let from = dir.join("one.md");
        fs::write(&from, "body").unwrap();
        let renamed = dir.join("nested").join("two.md");
        rename_path(from.to_string_lossy().into_owned(), renamed.to_string_lossy().into_owned()).unwrap();
        assert_eq!(fs::read_to_string(&renamed).unwrap(), "body");

        let moved = dir.join("elsewhere").join("three.md");
        move_file(renamed.to_string_lossy().into_owned(), moved.to_string_lossy().into_owned()).unwrap();
        assert_eq!(fs::read_to_string(&moved).unwrap(), "body");
        assert!(move_file(dir.join("missing.md").to_string_lossy().into_owned(), dir.join("nope.md").to_string_lossy().into_owned()).is_err());
    }

    #[test]
    fn copies_across_when_asked_and_restores_a_failed_remove() {
        let dir = temp_dir();
        let from = dir.join("one.md");
        let to = dir.join("two.md");
        fs::write(&from, "body").unwrap();
        copy_then_remove(from.to_str().unwrap(), to.to_str().unwrap()).unwrap();
        assert_eq!(fs::read_to_string(&to).unwrap(), "body");
        assert!(!from.exists());

        let stuck = dir.join("stuck");
        fs::create_dir(&stuck).unwrap();
        let leftover = dir.join("leftover.md");
        fs::write(&leftover, "x").unwrap();
        assert!(remove_copied_source(stuck.to_str().unwrap(), leftover.to_str().unwrap()).is_err());
        assert!(!leftover.exists());
        assert!(copy_then_remove(dir.join("gone.md").to_str().unwrap(), dir.join("out.md").to_str().unwrap()).is_err());
    }

    #[test]
    fn reads_a_book_path_from_arguments() {
        let dir = temp_dir();
        let found = book_from(["--", "-x", dir.to_str().unwrap()]).unwrap().unwrap();
        assert_eq!(found, dir.canonicalize().unwrap().to_string_lossy());
        assert!(book_from(["notes.md"]).is_err());
        assert!(book_from(["--", "-h"]).unwrap().is_none());
        assert!(help_flag(["--help"]));
        assert!(help_flag(["-h", "/tmp"]));
        assert!(!help_flag(["--", "--help"]));
        assert!(!help_flag([dir.to_str().unwrap()]));
        assert!(include_str!("../../README.md").contains(USAGE.trim_end()));
        let _ = startup_book_path();
        let _ = spec_book_path();
    }
}
