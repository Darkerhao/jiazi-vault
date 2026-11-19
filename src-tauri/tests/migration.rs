use keystill_lib::{backup, crypto, database as db, items, transfer, vault::Vault};
use serde_json::{Value, json};
use std::{
    fs,
    path::Path,
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};
use tempfile::TempDir;

fn fixture() -> Value {
    serde_json::from_str(include_str!("../../tests/fixtures/legacy.json")).unwrap()
}
fn legacy(version: usize) -> String {
    fs::read_to_string(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join(format!("../tests/fixtures/legacy-v{version}.jvault")),
    )
    .unwrap()
}
fn vault() -> (TempDir, Vault) {
    let dir = tempfile::tempdir().unwrap();
    let mut vault = Vault::new(dir.path().to_owned(), Arc::new(AtomicU64::new(0)));
    vault
        .call(
            "create_vault",
            &json!({"password":"test-master-password-2026"}),
        )
        .unwrap();
    (dir, vault)
}
fn item(vault: &mut Vault, title: &str) -> Value {
    vault.call("create_item",&json!({"item":{"type":"login","title":title,"password":"test-secret","favorite":false}})).unwrap()
}

#[test]
fn original_electron_argon2_key_and_aes_payload_are_readable() {
    let fixture = fixture();
    let metadata = serde_json::from_value(fixture["metadata"].clone()).unwrap();
    let key = crypto::unlock(fixture["password"].as_str().unwrap(), &metadata)
        .unwrap()
        .unwrap();
    assert_eq!(crypto::encode(*key), fixture["key"].as_str().unwrap());
    assert!(
        crypto::unlock("wrong-password", &metadata)
            .unwrap()
            .is_none()
    );
    let backup = backup::read(&legacy(4), fixture["password"].as_str().unwrap()).unwrap();
    let row = backup
        .items
        .iter()
        .find(|row| row["id"] == fixture["itemId"])
        .unwrap();
    let item = items::from_row(row, &key).unwrap();
    assert_eq!(item.password.as_deref(), Some("fixture-secret-B"));
    assert_eq!(item.notes.as_deref(), Some("测试备注\n第二行"));
}
#[test]
fn original_sqlite_file_opens_without_rewriting_the_vault_protocol() {
    let dir = tempfile::tempdir().unwrap();
    let connection = rusqlite::Connection::open(dir.path().join("vault.db")).unwrap();
    connection
        .execute_batch(include_str!("../../tests/fixtures/legacy-vault.sql"))
        .unwrap();
    drop(connection);
    let mut vault = Vault::new(dir.path().to_owned(), Arc::new(AtomicU64::new(0)));
    let f = fixture();
    assert_eq!(
        vault
            .call("unlock_vault", &json!({"password":f["password"]}))
            .unwrap()["unlocked"],
        true
    );
    let result = vault
        .call("get_item", &json!({"id":f["itemId"],"recordAccess":false}))
        .unwrap();
    assert_eq!(result, f["expected"]);
    assert_eq!(
        vault
            .call("list_item_history", &json!({"id":f["itemId"]}))
            .unwrap()
            .as_array()
            .unwrap()
            .len(),
        1
    );
}
#[test]
fn all_four_original_backup_versions_restore() {
    let f = fixture();
    for version in 1..=4 {
        let dir = tempfile::tempdir().unwrap();
        let db = db::open(dir.path()).unwrap();
        let backup = backup::read(&legacy(version), f["password"].as_str().unwrap()).unwrap();
        backup::restore(&db, &backup).unwrap();
        assert_eq!(db::rows(&db, "SELECT id FROM items", []).unwrap().len(), 3);
        assert_eq!(
            db::rows(&db, "SELECT id FROM projects", []).unwrap().len(),
            if version == 1 { 0 } else { 1 }
        );
        assert_eq!(
            db::rows(&db, "SELECT id FROM item_history", [])
                .unwrap()
                .len(),
            if version == 4 { 1 } else { 0 }
        );
    }
}
#[test]
fn rust_backup_can_be_decrypted_again_by_the_original_node_crypto() {
    let f = fixture();
    let dir = tempfile::tempdir().unwrap();
    let db = db::open(dir.path()).unwrap();
    let restored = backup::read(&legacy(4), f["password"].as_str().unwrap()).unwrap();
    backup::restore(&db, &restored).unwrap();
    let key = crypto::unlock(f["password"].as_str().unwrap(), &restored.metadata)
        .unwrap()
        .unwrap();
    let mut item = items::get(&db, &key, f["itemId"].as_str().unwrap(), false)
        .unwrap()
        .unwrap();
    item.password = Some("written-by-rust-中文".into());
    items::update(&db, &key, &item).unwrap();
    let output = Path::new(env!("CARGO_MANIFEST_DIR")).join("../output/compatibility");
    fs::create_dir_all(&output).unwrap();
    backup::write_private(
        &output.join("rust-v4.jvault"),
        backup::create(&db, &key).unwrap().as_bytes(),
    )
    .unwrap();
}
#[test]
fn tampering_wrong_password_and_format_downgrades_are_rejected() {
    let f = fixture();
    assert!(backup::read(&legacy(4), "wrong-password").is_err());
    let mut value: Value = serde_json::from_str(&legacy(4)).unwrap();
    value["payload"]["authTag"] = json!(crypto::encode([0_u8; 16]));
    assert!(backup::read(&value.to_string(), f["password"].as_str().unwrap()).is_err());
    let mut value: Value = serde_json::from_str(&legacy(4)).unwrap();
    value["version"] = json!(1);
    assert!(backup::read(&value.to_string(), f["password"].as_str().unwrap()).is_err());
    value["metadata"]["kdf"]["memoryCost"] = json!(1);
    assert!(backup::read(&value.to_string(), f["password"].as_str().unwrap()).is_err());
}
#[test]
fn random_nonce_encryption_and_authentication_round_trip() {
    let key = [7_u8; 32];
    let first = crypto::encrypt(&key, "多行\nsecret").unwrap();
    let second = crypto::encrypt(&key, "多行\nsecret").unwrap();
    assert_ne!(first, second);
    assert_eq!(&*crypto::decrypt(&key, &first).unwrap(), "多行\nsecret");
    assert!(crypto::decrypt(&[8; 32], &first).is_err());
}
#[test]
fn summaries_do_not_expose_passwords_notes_or_fields() {
    let (_dir, mut vault) = vault();
    let created = item(&mut vault, "hidden");
    for field in ["password", "notes", "fields"] {
        assert!(created.get(field).is_none());
    }
    assert_eq!(created["hasSensitiveData"], true);
    let rows = vault.call("list_items", &json!({})).unwrap();
    assert!(!rows.to_string().contains("test-secret"));
    let raw = db::rows(vault.connection().unwrap(), "SELECT secret FROM items", []).unwrap();
    assert!(!serde_json::to_string(&raw).unwrap().contains("test-secret"));
}
#[test]
fn encrypted_history_is_capped_and_restorable() {
    let (_dir, mut vault) = vault();
    let created = item(&mut vault, "history");
    for index in 0..23 {
        vault.call("update_item",&json!({"item":{"id":created["id"],"type":"login","title":format!("revision {index}"),"password":format!("secret-{index}"),"favorite":false}})).unwrap();
    }
    let history = vault
        .call("list_item_history", &json!({"id":created["id"]}))
        .unwrap();
    assert_eq!(history.as_array().unwrap().len(), 20);
    let restored = vault
        .call(
            "restore_item_history",
            &json!({"id":created["id"],"historyId":history[0]["id"]}),
        )
        .unwrap();
    assert_eq!(restored["title"], "revision 21");
}
#[test]
fn trash_recent_access_and_permanent_delete_keep_their_semantics() {
    let (_dir, mut vault) = vault();
    let created = item(&mut vault, "trash");
    let id = created["id"].clone();
    let full = vault.call("get_item", &json!({"id":id})).unwrap();
    assert!(full["lastAccessedAt"].is_number());
    vault.call("delete_item", &json!({"id":id})).unwrap();
    assert_eq!(vault.call("list_items", &json!({})).unwrap(), json!([]));
    assert_eq!(
        vault
            .call("list_items", &json!({"trashed":true}))
            .unwrap()
            .as_array()
            .unwrap()
            .len(),
        1
    );
    vault.call("restore_item", &json!({"id":id})).unwrap();
    vault
        .call("delete_item", &json!({"id":id,"permanently":true}))
        .unwrap();
    assert_eq!(
        vault.call("get_item", &json!({"id":id})).unwrap(),
        Value::Null
    );
}
#[test]
fn batch_edits_roll_back_every_item_and_its_history() {
    let (_dir, mut vault) = vault();
    let first = item(&mut vault, "first");
    let second = item(&mut vault, "second");
    let revision = db::revision(vault.connection().unwrap()).unwrap();
    assert!(vault.call("batch_items",&json!({"ids":[first["id"],second["id"],"missing"],"action":{"type":"environment","environment":"production"}})).is_err());
    assert_eq!(db::revision(vault.connection().unwrap()).unwrap(), revision);
    assert_eq!(
        vault
            .call("list_item_history", &json!({"id":first["id"]}))
            .unwrap(),
        json!([])
    );
}
#[test]
fn project_names_are_case_insensitive_and_deletion_preserves_credentials() {
    let (_dir, mut vault) = vault();
    let project = vault
        .call("create_project", &json!({"project":{"name":" Example "}}))
        .unwrap();
    assert_eq!(
        vault
            .call("create_project", &json!({"project":{"name":"example"}}))
            .unwrap_err()
            .0,
        "PROJECT_NAME_EXISTS"
    );
    let created = vault
        .call(
            "create_item",
            &json!({"item":{"type":"login","title":"project item","projectId":project["id"]}}),
        )
        .unwrap();
    vault
        .call("delete_project", &json!({"id":project["id"]}))
        .unwrap();
    let full = vault
        .call("get_item", &json!({"id":created["id"]}))
        .unwrap();
    assert!(full.get("projectId").is_none());
}
#[test]
fn master_password_rotation_covers_current_and_historical_ciphertexts() {
    let (_dir, mut vault) = vault();
    let created = item(&mut vault, "rotate");
    vault.call("update_item",&json!({"item":{"id":created["id"],"type":"login","title":"updated","password":"new-secret"}})).unwrap();
    vault.call("change_master_password",&json!({"currentPassword":"test-master-password-2026","newPassword":"changed-master-password"})).unwrap();
    assert!(!vault.active());
    assert_eq!(
        vault
            .call(
                "unlock_vault",
                &json!({"password":"test-master-password-2026"})
            )
            .unwrap()["unlocked"],
        false
    );
    assert_eq!(
        vault
            .call(
                "unlock_vault",
                &json!({"password":"changed-master-password"})
            )
            .unwrap()["unlocked"],
        true
    );
    let history = vault
        .call("list_item_history", &json!({"id":created["id"]}))
        .unwrap();
    assert_eq!(
        vault
            .call(
                "get_item_history",
                &json!({"id":created["id"],"historyId":history[0]["id"]})
            )
            .unwrap()["password"],
        "test-secret"
    );
}
#[test]
fn wrong_rotation_password_leaves_current_vault_readable() {
    let (_dir, mut vault) = vault();
    let created = item(&mut vault, "unchanged");
    assert!(
        vault
            .call(
                "change_master_password",
                &json!({"currentPassword":"wrong-password","newPassword":"changed-password"})
            )
            .is_err()
    );
    assert_eq!(
        vault
            .call("get_item", &json!({"id":created["id"]}))
            .unwrap()["password"],
        "test-secret"
    );
}
#[test]
fn rate_limiting_is_persisted_across_connections() {
    let dir = tempfile::tempdir().unwrap();
    let connection = db::open(dir.path()).unwrap();
    for _ in 0..5 {
        db::fail_unlock(&connection).unwrap();
    }
    let at = db::retry_at(&connection).unwrap();
    assert!(at > db::now());
    drop(connection);
    let db = db::open(dir.path()).unwrap();
    assert_eq!(db::retry_at(&db).unwrap(), at);
}
#[test]
fn lock_and_late_authentication_cannot_resurrect_a_session() {
    let (_dir, mut vault) = vault();
    let epoch = vault.generation();
    vault.epoch.fetch_add(1, Ordering::SeqCst);
    assert!(!vault.active());
    assert_eq!(
        vault
            .adopt(zeroize::Zeroizing::new([7; 32]), epoch)
            .unwrap_err()
            .0,
        "VAULT_LOCKED"
    );
    vault.lock();
    assert!(!vault.has_key());
}
#[test]
fn inactivity_cannot_be_undone_by_a_late_activity_event() {
    let (_dir, mut vault) = vault();
    vault.last_activity = Instant::now() - Duration::from_secs(901);
    vault.touch();
    assert!(!vault.active());
    assert!(vault.key().is_err());
}
#[test]
fn preferences_persist_and_invalid_settings_do_not_overwrite_them() {
    let (dir, mut vault) = vault();
    let settings = json!({"themeMode":"dark","clipboardClearTimeout":5,"autoLockMinutes":null});
    vault
        .call("update_settings", &json!({"settings":settings}))
        .unwrap();
    assert!(
        vault
            .call(
                "update_settings",
                &json!({"settings":{"themeMode":"x","clipboardClearTimeout":0,"autoLockMinutes":1}})
            )
            .is_err()
    );
    drop(vault);
    let mut vault = Vault::new(dir.path().to_owned(), Arc::new(AtomicU64::new(0)));
    assert_eq!(vault.call("get_settings", &Value::Null).unwrap(), settings);
}
#[test]
fn corrupt_database_still_exposes_the_recovery_entry() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("vault.db"), b"broken database").unwrap();
    let mut vault = Vault::new(dir.path().to_owned(), Arc::new(AtomicU64::new(0)));
    assert_eq!(
        vault.call("get_vault_status", &Value::Null).unwrap()["databaseError"],
        true
    );
    assert_eq!(
        vault.call("list_recovery_snapshots", &Value::Null).unwrap(),
        json!([])
    );
}
#[test]
fn recovery_prepares_the_replacement_and_preserves_the_damaged_original() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("vault.db"), b"broken database").unwrap();
    let f = fixture();
    let backup = backup::read(&legacy(4), f["password"].as_str().unwrap()).unwrap();
    backup::recover(dir.path(), &backup).unwrap();
    let db = db::open(dir.path()).unwrap();
    assert_eq!(db::rows(&db, "SELECT id FROM items", []).unwrap().len(), 3);
    let preserved = fs::read_dir(dir.path().join("recovery"))
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path()
        .join("vault.db");
    assert_eq!(fs::read(preserved).unwrap(), b"broken database");
}
#[test]
fn restore_is_atomic_and_keeps_device_preferences() {
    let (_dir, mut vault) = vault();
    let created = item(&mut vault, "original");
    db::save_setting(
        vault.connection().unwrap(),
        "desktop-preferences",
        &json!({"silentStart":true,"closeToTray":false}),
    )
    .unwrap();
    let f = fixture();
    let mut backup = backup::read(&legacy(4), f["password"].as_str().unwrap()).unwrap();
    backup.items[0]["id"] = backup.items[1]["id"].clone();
    assert!(backup::restore(vault.connection().unwrap(), &backup).is_err());
    assert!(items::raw(vault.connection().unwrap(), created["id"].as_str().unwrap()).is_ok());
    let valid = backup::read(&legacy(4), f["password"].as_str().unwrap()).unwrap();
    backup::restore(vault.connection().unwrap(), &valid).unwrap();
    assert_eq!(
        db::setting(vault.connection().unwrap(), "desktop-preferences")
            .unwrap()
            .unwrap()["silentStart"],
        true
    );
}
#[test]
fn snapshots_require_a_known_id_and_the_original_password() {
    let (dir, mut vault) = vault();
    item(&mut vault, "snapshot");
    let id = backup::snapshot(vault.connection().unwrap(), dir.path()).unwrap();
    assert!(backup::read_snapshot(dir.path(), "../vault.db", "test-master-password-2026").is_err());
    assert!(backup::read_snapshot(dir.path(), &id, "wrong-password").is_err());
    assert_eq!(
        backup::read_snapshot(dir.path(), &id, "test-master-password-2026")
            .unwrap()
            .items
            .len(),
        1
    );
}
#[test]
fn automatic_backups_track_changes_and_keep_only_owned_files() {
    let (dir, mut vault) = vault();
    let folder = dir.path().join("automatic");
    fs::create_dir(&folder).unwrap();
    fs::write(folder.join("keep.txt"), b"not ours").unwrap();
    db::save_setting(
        vault.connection().unwrap(),
        "automatic_backup",
        &json!({"directory":folder}),
    )
    .unwrap();
    item(&mut vault, "backup");
    assert!(vault.automatic_backup(false).unwrap());
    assert!(!vault.automatic_backup(false).unwrap());
    for _ in 0..12 {
        vault.automatic_backup(true).unwrap();
    }
    assert_eq!(
        fs::read_dir(&folder)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.path().extension().is_some_and(|v| v == "jvault"))
            .count(),
        10
    );
    assert!(folder.join("keep.txt").exists());
    assert_eq!(
        db::backup_status(vault.connection().unwrap()).unwrap()["hasChanges"],
        false
    );
}
#[test]
fn import_preview_never_contains_secrets_and_deduplicates_records() {
    let (_dir, vault) = vault();
    let input = json!([{"type":"login","title":"Imported","password":"never-in-preview"},{"type":"login","title":"Imported","password":"never-in-preview"},{"type":"login","title":"bad","port":99999}]);
    let records = transfer::parse(&input.to_string(), "json").unwrap();
    let preview =
        transfer::preview(vault.connection().unwrap(), vault.key().unwrap(), &records).unwrap();
    assert!(!preview.to_string().contains("never-in-preview"));
    assert_eq!(preview["duplicateCount"], 1);
    assert_eq!(preview["invalidCount"], 1);
    assert_eq!(
        transfer::import(
            vault.connection().unwrap(),
            vault.key().unwrap(),
            &records,
            true
        )
        .unwrap(),
        1
    );
    assert_eq!(
        transfer::import(
            vault.connection().unwrap(),
            vault.key().unwrap(),
            &records,
            true
        )
        .unwrap(),
        0
    );
}
#[test]
fn json_and_csv_round_trip_multiline_and_formula_like_values() {
    let (_dir, vault) = vault();
    let source = json!([{"type":"custom","title":"=SUM(A1)","password":"'sensitive","notes":"line1\nline2","tags":["a","b"],"fields":{"__proto__":"literal-key"},"project":"Project"}]);
    let records = transfer::parse(&source.to_string(), "json").unwrap();
    assert_eq!(
        transfer::import(
            vault.connection().unwrap(),
            vault.key().unwrap(),
            &records,
            true
        )
        .unwrap(),
        1
    );
    for format in ["json", "csv"] {
        let output = transfer::export(
            vault.connection().unwrap(),
            vault.key().unwrap(),
            format,
            &Value::Null,
        )
        .unwrap();
        let parsed = transfer::parse(&output, format).unwrap();
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].item.as_ref().unwrap()["title"], "=SUM(A1)");
        assert_eq!(
            parsed[0].item.as_ref().unwrap()["fields"]["__proto__"],
            "literal-key"
        );
    }
}
#[test]
fn export_scope_rejects_missing_or_trashed_selected_ids() {
    let (_dir, mut vault) = vault();
    let created = item(&mut vault, "selected");
    vault
        .call("delete_item", &json!({"id":created["id"]}))
        .unwrap();
    assert_eq!(
        transfer::export(
            vault.connection().unwrap(),
            vault.key().unwrap(),
            "json",
            &json!({"kind":"items","ids":[created["id"]]})
        )
        .unwrap_err()
        .0,
        "EXPORT_ITEMS_CHANGED"
    );
}
#[test]
fn env_serialization_preserves_values_or_fails_explicitly() {
    let fields = serde_json::from_value(
        json!({"EMPTY":"","MULTI":"a\nb","HASH":"a#b","QUOTES":"it's quoted","LITERAL":"${HOME}"}),
    )
    .unwrap();
    let text = items::serialize_env(&fields).unwrap();
    assert!(text.contains("MULTI='a\nb'"));
    assert!(text.contains("LITERAL=${HOME}"));
    let fields = serde_json::from_value(json!({"BAD":"both ' and \" #"})).unwrap();
    assert!(items::serialize_env(&fields).is_err());
}
#[test]
fn invalid_dates_ports_environments_and_env_names_are_rejected() {
    let (_dir, mut vault) = vault();
    for input in [
        json!({"type":"api-key","title":"bad","fields":{"expiresAt":"2026-02-30"}}),
        json!({"type":"login","title":"bad","port":65536}),
        json!({"type":"env","title":"bad","fields":{"KEY":"value"}}),
        json!({"type":"env","title":"bad","environment":"production","fields":{"BAD-KEY":"value"}}),
    ] {
        assert!(vault.call("create_item", &json!({"item":input})).is_err());
    }
}
#[test]
fn health_results_return_identifiers_and_issue_types_only() {
    let (_dir, mut vault) = vault();
    item(&mut vault, "first");
    item(&mut vault, "second");
    let health = vault.call("get_credential_health", &Value::Null).unwrap();
    assert_eq!(health.as_array().unwrap().len(), 2);
    assert!(!health.to_string().contains("test-secret"));
    for entry in health.as_array().unwrap() {
        assert!(
            entry["issues"]
                .as_array()
                .unwrap()
                .contains(&json!("reused-password"))
        );
    }
}
#[test]
fn generator_covers_selected_groups_and_excludes_ambiguous_characters() {
    for _ in 0..100 {
        let generated=keystill_lib::vault::generate_password(&json!({"length":24,"uppercase":true,"lowercase":true,"numbers":true,"symbols":true,"excludeAmbiguous":true})).unwrap();
        let value = generated["password"].as_str().unwrap();
        assert_eq!(value.len(), 24);
        assert!(value.bytes().any(|c| c.is_ascii_uppercase()));
        assert!(value.bytes().any(|c| c.is_ascii_lowercase()));
        assert!(value.bytes().any(|c| c.is_ascii_digit()));
        assert!(!value.contains(['0', 'O', '1', 'I', 'l', '|']));
        assert!(generated["entropy"].as_f64().unwrap() > 100.0);
    }
}
#[test]
fn private_writes_replace_existing_files_without_leaving_temporary_files() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("test.jvault");
    backup::write_private(&path, b"old").unwrap();
    backup::write_private(&path, b"new").unwrap();
    assert_eq!(fs::read(&path).unwrap(), b"new");
    assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
}
#[test]
fn production_origins_do_not_accept_remote_or_lookalike_hosts() {
    for url in ["http://tauri.localhost/", "tauri://localhost/index.html"] {
        assert!(keystill_lib::application_url(&url.parse().unwrap()));
    }
    for url in [
        "https://example.com/",
        "http://tauri.localhost.evil.test/",
        "http://127.0.0.1:4444/",
    ] {
        assert!(!keystill_lib::application_url(&url.parse().unwrap()));
    }
}

#[test]
fn invalid_csv_syntax_is_rejected_before_any_record_is_imported() {
    for contents in [
        "type,title\nlogin,\"unterminated",
        "type,title\nlogin,\"closed\"trailing",
        "type,title\nlogin,un\"quoted",
    ] {
        assert!(transfer::parse(contents, "csv").is_err());
    }
    let rows = transfer::parse(
        "type,title,port\nserver,Valid,5432\nserver,Invalid,+5432\n",
        "csv",
    )
    .unwrap();
    assert!(rows[0].item.is_some());
    assert!(rows[1].error.is_some());
    let rows = transfer::parse(
        r#"[{"type":"login","title":"invalid null fields","fields":null}]"#,
        "json",
    )
    .unwrap();
    assert!(rows[0].error.is_some());
}

#[test]
fn failed_backup_preview_invalidates_a_previously_authorized_restore() {
    let (directory, mut vault) = vault();
    let f = fixture();
    let path = directory.path().join("source.jvault");
    fs::write(&path, legacy(4)).unwrap();
    let restored = backup::read(&legacy(4), f["password"].as_str().unwrap()).unwrap();
    vault.pending_restore = Some(keystill_lib::vault::PendingRestore {
        token: "test-token".into(),
        epoch: vault.generation(),
        name: "fixture".into(),
        path: Some(path),
        snapshot_id: None,
        backup: Some(restored),
    });
    assert!(
        vault
            .call(
                "preview_backup",
                &json!({"token":"test-token","password":"wrong-password"})
            )
            .is_err()
    );
    assert!(
        vault
            .call("restore_backup", &json!({"token":"test-token"}))
            .is_err()
    );
}

#[test]
fn lock_during_a_private_export_preserves_the_previous_destination() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("export.json");
    fs::write(&path, b"previous").unwrap();
    let checks = std::cell::Cell::new(0);
    let result = backup::write_private_guarded(&path, b"new secret", || {
        checks.set(checks.get() + 1);
        if checks.get() > 1 {
            Err(keystill_lib::error::Error("VAULT_LOCKED"))
        } else {
            Ok(())
        }
    });
    assert!(result.is_err());
    assert_eq!(fs::read(&path).unwrap(), b"previous");
    assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
}

#[test]
fn corrupted_ciphertext_returns_the_safe_recovery_error_code() {
    let (_directory, mut vault) = vault();
    let created = item(&mut vault, "damaged");
    vault
        .connection()
        .unwrap()
        .execute(
            "UPDATE items SET secret='invalid-json' WHERE id=?",
            [created["id"].as_str().unwrap()],
        )
        .unwrap();
    assert_eq!(
        vault
            .call("get_item", &json!({"id":created["id"]}))
            .unwrap_err()
            .0,
        "DECRYPT_FAILED"
    );
}
