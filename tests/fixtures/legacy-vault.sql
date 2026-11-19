CREATE TABLE unlock_attempts (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      failures INTEGER NOT NULL,
      retry_at INTEGER NOT NULL
    );
CREATE TABLE vault_metadata (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
CREATE TABLE settings (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
CREATE TABLE projects (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      icon TEXT,
      color TEXT,
      description TEXT,
      last_accessed_at INTEGER
    );
CREATE TABLE items (
      id TEXT PRIMARY KEY NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      project_id TEXT,
      environment TEXT,
      username TEXT,
      url TEXT,
      host TEXT,
      port INTEGER,
      tags TEXT NOT NULL DEFAULT '[]',
      secret TEXT NOT NULL,
      has_secret INTEGER NOT NULL DEFAULT 0,
      favorite INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER
    , last_accessed_at INTEGER);
CREATE TABLE item_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      saved_at INTEGER NOT NULL,
      payload TEXT NOT NULL
    );
INSERT INTO vault_metadata (key,value) VALUES ('vault','{"version":1,"kdf":{"algorithm":"Argon2id","memoryCost":65536,"timeCost":3,"parallelism":1,"outputLen":32,"salt":"KGhtxotUpReJcpyJ0yfFug=="},"verifier":{"algorithm":"AES-256-GCM","nonce":"MsFgZiwFH2lyFQ/R","ciphertext":"agpuMviwg9Y5iIrgllgrKCwSaLhbMDY=","authTag":"+DnPXJr3K5DmqBP7HrxZgA=="}}');
INSERT INTO settings (key,value) VALUES ('backup_revision','9');
INSERT INTO projects (id,name,icon,color,description,last_accessed_at) VALUES ('87f1e838-99bd-41b3-a318-99d64b3b2572','迁移测试','🔐','#C96100',NULL,NULL);
INSERT INTO items (id,type,title,project_id,environment,username,url,host,port,tags,secret,has_secret,favorite,created_at,updated_at,deleted_at,last_accessed_at) VALUES ('2701fa63-02ef-42eb-9f07-294470ec2711','login','Legacy account','87f1e838-99bd-41b3-a318-99d64b3b2572',NULL,'fixture-user',NULL,NULL,NULL,'["fixture"]','{"algorithm":"AES-256-GCM","version":1,"nonce":"F8llnLDDxH6gZnW2","ciphertext":"YQp1B3MUi1ANcu9w2gktaWB6p+k7d17XrLuoziL3wgq69YHJ83CWS+fX7IvAbtzxsZQIqNDN+vvbtRpBXIDKbaGYCl8fznPxGVoqRSAjiICEF619v8QZ4+IS06k6lV5fu+ZRXg==","authTag":"4tZvAQ48yXVhLOH36/cU+A=="}',1,1,1795073440543,1795073440546,NULL,NULL);
INSERT INTO items (id,type,title,project_id,environment,username,url,host,port,tags,secret,has_secret,favorite,created_at,updated_at,deleted_at,last_accessed_at) VALUES ('6aa4baac-2b4a-4d90-ab62-bd60d8f11282','env','测试环境变量',NULL,'development',NULL,NULL,NULL,NULL,'[]','{"algorithm":"AES-256-GCM","version":1,"nonce":"HYQqZfwfmYFpbRZA","ciphertext":"/UO+Bu9ssOQ2QX0X7rInvoNnnnxAkNhMc2sW5kLdFX+1v92UVEhidTpq1RAJX1ECaa8L0sKZxrXSkKciko6DFw==","authTag":"J/HrUC4HVuvmZhuG3fKlvw=="}',1,0,1795073440548,1795073440548,NULL,NULL);
INSERT INTO items (id,type,title,project_id,environment,username,url,host,port,tags,secret,has_secret,favorite,created_at,updated_at,deleted_at,last_accessed_at) VALUES ('6c3405cf-0197-4f38-ae7b-5ac73ea00195','secure-note','Trashed fixture',NULL,NULL,NULL,NULL,NULL,NULL,'[]','{"algorithm":"AES-256-GCM","version":1,"nonce":"41CtatYY0kv1XhA1","ciphertext":"jnmzykqbQlenQ7o/b8uabSzL51hxcVrrK7ix","authTag":"tUGNsWTSVGMGsD39x776Sg=="}',1,0,1795073440551,1795073440551,4070908800000,NULL);
INSERT INTO item_history (id,item_id,saved_at,payload) VALUES (1,'2701fa63-02ef-42eb-9f07-294470ec2711',1795073440546,'{"algorithm":"AES-256-GCM","version":1,"nonce":"BD/eVZ85Oug4pRas","ciphertext":"9cNgRhZlLdR9/WTZJw6KOuafM9cuDUqKncCMhfX/SzO0MSmjukRnbjUO2cmeY2sszQQ/qMqGOHpcSWG2Xl04c302B5F1DEFbwoZDkiKZb29IJBds1cvU2ZOAr5Gagx5EZK0vSFKrP7hrptlLVq59iqGFKNc2W1BURvO0UbfqVHkk31GFqAEbQU/aSb+LL74zOC6oj63p1LAc63UhZKtYH5tsvGPyRXkJS45MZ9aJUKSoYZXDgLejijUlTVINl13x/SNEVzb4bERQVLU+JYs7P7rF3c4L0hyeFvPFKvqljN6+PW4576LOvu7DY0RWxHHTpGRqvNqj3qLHemG1+QxxHpo204vGm3SQ3s4YLFWNPSNoP/rjXT5rWi310EY5Nzu/AV3ssmsRs/WFuUmhFxdjnGgga98+EOV2ZX9xkdjmjeSmlupmnhILKmAo5B2facBInyaGfhqfshEFuxdx","authTag":"gQKhpT/X42JnF5X4eKjrGw=="}');
