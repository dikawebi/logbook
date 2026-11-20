CREATE TABLE users (
    email VARCHAR(190) PRIMARY KEY,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('ADMIN','USER','GUEST') NOT NULL DEFAULT 'USER',
    active TINYINT(1) NOT NULL DEFAULT 1,
    must_change TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE transactions (
    id VARCHAR(64) PRIMARY KEY,
    currency ENUM('IDR','USD') NOT NULL,
    source_row INT NULL,
    data JSON NOT NULL,
    vat_multiplier DECIMAL(5,3) NULL,
    received_date DATE NULL,
    due_date DATE NULL,
    vendor VARCHAR(255) NOT NULL DEFAULT '',
    invoice VARCHAR(255) NOT NULL DEFAULT '',
    description TEXT NULL,
    category VARCHAR(190) NOT NULL DEFAULT '',
    payment_status VARCHAR(20) NOT NULL DEFAULT '',
    cancelled TINYINT(1) NOT NULL DEFAULT 0,
    edited_at DATETIME NULL,
    imported_at DATETIME NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY lookup (currency, received_date),
    KEY category_lookup (currency, category),
    KEY invoice_lookup (currency, invoice),
    KEY payment_due_lookup (currency, cancelled, payment_status, due_date),
    KEY vat_multiplier_lookup (currency, vat_multiplier)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE audit_logs (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    source_key VARCHAR(80) UNIQUE NULL,
    happened_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    email VARCHAR(190) NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT '',
    record_id VARCHAR(64) NOT NULL DEFAULT '',
    action VARCHAR(40) NOT NULL,
    column_name VARCHAR(100) NOT NULL DEFAULT '',
    old_value TEXT NULL,
    new_value TEXT NULL,
    invoice_snapshot VARCHAR(255) NOT NULL DEFAULT '',
    vendor_snapshot VARCHAR(255) NOT NULL DEFAULT '',
    invoice_date_snapshot DATE NULL,
    KEY recent (id),
    KEY record_lookup (record_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sheet_headers (
    currency ENUM('IDR','USD') PRIMARY KEY,
    labels JSON NOT NULL,
    synced_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
