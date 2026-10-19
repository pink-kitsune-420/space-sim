#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            tauri::WebviewWindowBuilder::from_config(app.handle(), &app.config().app.windows[0])?
                .on_document_title_changed(|window, title| {
                    let _ = window.set_title(if title.is_empty() { "Spacelab" } else { &title });
                })
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
