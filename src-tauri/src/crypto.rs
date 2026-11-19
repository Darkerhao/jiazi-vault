use crate::error::{Error, Result, ensure};
use aes_gcm::{Aes256Gcm, KeyInit, Nonce, aead::Aead};
use argon2::{Algorithm, Argon2, Params, Version};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

pub type Key = Zeroizing<[u8; 32]>;
const VERIFIER: &[u8] = b"jiazi-vault-verifier-v1";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Encrypted {
    pub algorithm: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<u8>,
    pub nonce: String,
    pub ciphertext: String,
    pub auth_tag: String,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Kdf {
    pub algorithm: String,
    pub memory_cost: u32,
    pub time_cost: u32,
    pub parallelism: u32,
    pub output_len: usize,
    pub salt: String,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Metadata {
    pub version: u8,
    pub kdf: Kdf,
    pub verifier: Encrypted,
}

pub fn random<const N: usize>() -> Result<[u8; N]> {
    let mut bytes = [0; N];
    getrandom::fill(&mut bytes).map_err(|_| Error("RANDOM_FAILED"))?;
    Ok(bytes)
}
pub fn decode(value: &str) -> Result<Vec<u8>> {
    let bytes = STANDARD.decode(value).map_err(|_| Error("INVALID_DATA"))?;
    ensure(STANDARD.encode(&bytes) == value, "INVALID_DATA")?;
    Ok(bytes)
}
pub fn encode(value: impl AsRef<[u8]>) -> String {
    STANDARD.encode(value)
}

impl Metadata {
    pub fn validate(&self) -> Result<()> {
        ensure(
            self.version == 1
                && self.kdf.algorithm == "Argon2id"
                && self.kdf.memory_cost == 65536
                && self.kdf.time_cost == 3
                && self.kdf.parallelism == 1
                && self.kdf.output_len == 32
                && decode(&self.kdf.salt)?.len() == 16,
            "INVALID_DATA",
        )?;
        self.verifier.validate()
    }
}
impl Encrypted {
    fn validate(&self) -> Result<()> {
        ensure(
            self.algorithm == "AES-256-GCM"
                && decode(&self.nonce)?.len() == 12
                && decode(&self.auth_tag)?.len() == 16,
            "INVALID_DATA",
        )?;
        decode(&self.ciphertext)?;
        Ok(())
    }
}

fn derive(password: &str, salt: &[u8]) -> Result<Key> {
    let params = Params::new(65536, 3, 1, Some(32)).map_err(|_| Error("INVALID_DATA"))?;
    let mut key = Zeroizing::new([0; 32]);
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(password.as_bytes(), salt, &mut *key)
        .map_err(|_| Error("INVALID_DATA"))?;
    Ok(key)
}
fn encrypt_bytes(key: &[u8; 32], value: &[u8], version: Option<u8>) -> Result<Encrypted> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| Error("INVALID_DATA"))?;
    let nonce = Nonce::from(random::<12>()?);
    let mut ciphertext = cipher
        .encrypt(&nonce, value)
        .map_err(|_| Error("ENCRYPT_FAILED"))?;
    let tag = ciphertext.split_off(ciphertext.len() - 16);
    Ok(Encrypted {
        algorithm: "AES-256-GCM".into(),
        version,
        nonce: encode(nonce),
        ciphertext: encode(ciphertext),
        auth_tag: encode(tag),
    })
}
fn decrypt_bytes(key: &[u8; 32], value: &Encrypted) -> Result<Zeroizing<Vec<u8>>> {
    value.validate()?;
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| Error("INVALID_DATA"))?;
    let nonce = Nonce::from(
        <[u8; 12]>::try_from(decode(&value.nonce)?).map_err(|_| Error("INVALID_DATA"))?,
    );
    let mut ciphertext = decode(&value.ciphertext)?;
    ciphertext.extend(decode(&value.auth_tag)?);
    cipher
        .decrypt(&nonce, ciphertext.as_ref())
        .map(Zeroizing::new)
        .map_err(|_| Error("DECRYPT_FAILED"))
}
pub fn encrypt(key: &[u8; 32], value: &str) -> Result<String> {
    Ok(serde_json::to_string(&encrypt_bytes(
        key,
        value.as_bytes(),
        Some(1),
    )?)?)
}
pub fn decrypt(key: &[u8; 32], value: &str) -> Result<Zeroizing<String>> {
    let encrypted: Encrypted = serde_json::from_str(value)?;
    ensure(encrypted.version == Some(1), "INVALID_DATA")?;
    let bytes = decrypt_bytes(key, &encrypted)?;
    String::from_utf8(bytes.to_vec())
        .map(Zeroizing::new)
        .map_err(|_| Error("DECRYPT_FAILED"))
}
pub fn create(password: &str) -> Result<(Metadata, Key)> {
    let salt = random::<16>()?;
    let key = derive(password, &salt)?;
    let metadata = Metadata {
        version: 1,
        kdf: Kdf {
            algorithm: "Argon2id".into(),
            memory_cost: 65536,
            time_cost: 3,
            parallelism: 1,
            output_len: 32,
            salt: encode(salt),
        },
        verifier: encrypt_bytes(&key, VERIFIER, None)?,
    };
    Ok((metadata, key))
}
pub fn verify(key: &[u8; 32], metadata: &Metadata) -> bool {
    metadata.validate().is_ok()
        && decrypt_bytes(key, &metadata.verifier).is_ok_and(|value| value.as_slice() == VERIFIER)
}
pub fn unlock(password: &str, metadata: &Metadata) -> Result<Option<Key>> {
    metadata.validate()?;
    let key = derive(password, &decode(&metadata.kdf.salt)?)?;
    Ok(if verify(&key, metadata) {
        Some(key)
    } else {
        None
    })
}
