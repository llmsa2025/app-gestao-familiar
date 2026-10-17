# Certificados de bancos remotos

`supabase-root-2021-ca.crt` — raiz pública do Supabase ("Supabase Root 2021 CA", válida até
26/04/2031, SHA-256 `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`).
Baixada de `https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt`
e conferida em 16/10/2026: fecha a cadeia que o pooler do Supabase (`aws-N-sa-east-1.pooler.supabase.com`,
com o `N` e a região do seu projeto) apresenta (`openssl s_client -starttls postgres … -CAfile` → `Verification: OK`).

É certificado **público** (não é segredo). Vai para a Vercel como `DATABASE_CA`, em base64 de
uma linha: `base64 -w0 servidor/certs/supabase-root-2021-ca.crt`. O app só aceita o banco se ele
provar que foi assinado por esta CA (`servidor/src/db.mjs`).
