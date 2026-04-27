package testutil

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

// SeedMasterIfMissing inserts minimum master data idempotently.
func SeedMasterIfMissing(ctx context.Context, pool *pgxpool.Pool) error {
	stmts := []string{
		`INSERT INTO users (id, email, name, password_hash, role, is_active, created_by, updated_by)
		 VALUES (1, 'test-superadmin@globalsakti.local', 'Test Superadmin',
		         '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
		         'superadmin', TRUE, 1, 1)
		 ON CONFLICT (id) DO NOTHING`,

		`SELECT setval('users_id_seq', GREATEST(1, (SELECT COALESCE(MAX(id), 1) FROM users)), true)`,

		`INSERT INTO units (code, name, coretax_code) VALUES
		   ('MT','Metrik Ton','UM.0001'),('WT','Wet Ton','UM.0002'),('KG','Kilogram','UM.0003'),
		   ('GR','Gram','UM.0004'),('KRT','Karat','UM.0005'),('KL','Kiloliter','UM.0006'),
		   ('LTR','Liter','UM.0007'),('BBL','Barrel','UM.0008'),('MMBTU','MMBTU','UM.0009'),
		   ('AMP','Ampere','UM.0010'),('CM3','Sentimeter Kubik','UM.0011'),('M2','Meter Persegi','UM.0012'),
		   ('MTR','Meter','UM.0013'),('IN','Inches','UM.0014'),('CM','Sentimeter','UM.0015'),
		   ('YD','Yard','UM.0016'),('DOZ','Lusin','UM.0017'),('UNIT','Unit','UM.0018'),
		   ('SET','Set','UM.0019'),('LBR','Lembar','UM.0020'),('PCS','Piece','UM.0021'),
		   ('BOX','Boks','UM.0022'),('YR','Tahun','UM.0023'),('MON','Bulan','UM.0024'),
		   ('WK','Minggu','UM.0025'),('DAY','Hari','UM.0026'),('HR','Jam','UM.0027'),
		   ('MIN','Menit','UM.0028'),('PCT','Persen','UM.0029'),('KEG','Kegiatan','UM.0030'),
		   ('LAP','Laporan','UM.0031'),('BHN','Bahan','UM.0032'),('OTH','Lainnya','UM.0033'),
		   ('TIN','Tin/Can','UM.0033'),('TUB','Tube','UM.0033'),('PKT','Pack/Packet','UM.0033'),
		   ('BTL','Botol/Bottle','UM.0033'),('PRS','Pairs/Pasang','UM.0033'),('RLS','Roll/Gulung','UM.0033'),
		   ('SPL','Spool','UM.0033')
		 ON CONFLICT (code) DO NOTHING`,

		`INSERT INTO company_client (id, number, name, npwp, address, country_code, created_by, updated_by)
		 VALUES (1, '2641', 'PT. IMC Ship Management', '0612345678901000',
		         'Jakarta Selatan', 'IDN', 1, 1)
		 ON CONFLICT (id) DO NOTHING`,

		`INSERT INTO company_client (id, number, name, country_code, created_by, updated_by)
		 VALUES (2, '0779', 'PT. Yuxin Shipping Line', 'IDN', 1, 1)
		 ON CONFLICT (id) DO NOTHING`,

		`SELECT setval('company_client_id_seq', GREATEST(2, (SELECT COALESCE(MAX(id), 1) FROM company_client)), true)`,

		`INSERT INTO company_contacts (id, company_id, name, email, country_code, created_by, updated_by)
		 VALUES (1, 1, 'Bp. Restu Umar Singgih', 'restu@imc.example', 'IDN', 1, 1)
		 ON CONFLICT (id) DO NOTHING`,

		`SELECT setval('company_contacts_id_seq', GREATEST(1, (SELECT COALESCE(MAX(id), 1) FROM company_contacts)), true)`,

		`INSERT INTO vendors (id, name, location, contact_info, created_by, updated_by)
		 VALUES (1, 'Toko ABC Jakarta', 'Jakarta Barat',
		         '{"email":"abc@vendor.com","phone":"+6281234567890"}'::jsonb, 1, 1)
		 ON CONFLICT (id) DO NOTHING`,

		`INSERT INTO vendors (id, name, location, contact_info, created_by, updated_by)
		 VALUES (2, 'CV Marine Supply', 'Surabaya',
		         '{"whatsapp":"+6287712345678"}'::jsonb, 1, 1)
		 ON CONFLICT (id) DO NOTHING`,

		`INSERT INTO vendors (id, name, location, contact_info, created_by, updated_by)
		 VALUES (3, 'PT Tekiro Indonesia', 'Jakarta Timur',
		         '{"email":"sales@tekiro.example"}'::jsonb, 1, 1)
		 ON CONFLICT (id) DO NOTHING`,

		`SELECT setval('vendors_id_seq', GREATEST(3, (SELECT COALESCE(MAX(id), 1) FROM vendors)), true)`,

		`INSERT INTO items (id, name, impa_code, default_unit_id, created_by, updated_by)
		 VALUES (1, 'PUNCHING TOOL SET DIES & TABLE, 6-38MM 16S', '613802', 19, 1, 1)
		 ON CONFLICT (id) DO NOTHING`,

		`INSERT INTO items (id, name, default_unit_id, created_by, updated_by)
		 VALUES (2, 'PRUSIAN BLUE Permatex 22ml (Tube)', 35, 1, 1)
		 ON CONFLICT (id) DO NOTHING`,

		`INSERT INTO items (id, name, impa_code, default_unit_id, created_by, updated_by)
		 VALUES (3, 'LAMP LED 12W (100W) 220V E-27, COOL WHITE', '790268', 21, 1, 1)
		 ON CONFLICT (id) DO NOTHING`,

		`SELECT setval('items_id_seq', GREATEST(3, (SELECT COALESCE(MAX(id), 1) FROM items)), true)`,

		`INSERT INTO vendor_products (id, vendor_id, item_id, vendor_sku, cost_price, created_by, updated_by)
		 VALUES (1, 3, 1, 'TEK-PT16', 1200000, 1, 1)
		 ON CONFLICT (id) DO NOTHING`,

		`INSERT INTO vendor_products (id, vendor_id, item_id, vendor_sku, cost_price, created_by, updated_by)
		 VALUES (2, 1, 2, 'ABC-PB22', 90000, 1, 1)
		 ON CONFLICT (id) DO NOTHING`,

		`INSERT INTO vendor_products (id, vendor_id, item_id, vendor_sku, cost_price, created_by, updated_by)
		 VALUES (3, 2, 3, 'MS-LED12', 28000, 1, 1)
		 ON CONFLICT (id) DO NOTHING`,

		`SELECT setval('vendor_products_id_seq', GREATEST(3, (SELECT COALESCE(MAX(id), 1) FROM vendor_products)), true)`,
	}
	for _, s := range stmts {
		if _, err := pool.Exec(ctx, s); err != nil {
			return err
		}
	}
	return nil
}
