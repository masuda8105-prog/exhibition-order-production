# 展示会注文管理

登録スタッフ専用の展示会注文UIです。公開GitHubには画面と処理だけを置き、商品名・卸価格・帳合先はSupabaseからログイン後に取得します。注文と顧客情報はブラウザのメモリだけで扱い、クラウドや端末へ保存しません。

公開URL: https://masuda8105-prog.github.io/exhibition-order-production/

## データの保存場所

| 保存場所 | 保存するもの | 保存しないもの |
| --- | --- | --- |
| GitHub | HTML、CSS、JavaScript、一般公開ロゴ、テスト、Supabaseマイグレーション、公開設定のひな形 | 商品マスター、卸価格、価格改定Excel、非公開画像、顧客情報、注文履歴、生成済み接続設定 |
| Supabase | Auth、スタッフ権限、商品マスター、卸価格、帳合先 | 新しい注文、顧客情報、注文PDF |
| ブラウザメモリ | 開いているタブで入力中・印刷前の注文 | タブ終了後に残す注文履歴 |
| `sessionStorage` | ログインセッション（タブを閉じると終了） | 注文・顧客情報 |
| `localStorage` | スタッフ表示名、固定キーの左右設定 | 注文、会社名、担当者名、電話番号、備考、商品、数量 |

印刷画面を閉じると、対象注文の会社名、担当者名、電話番号、帳合先、住所・宿泊情報、備考、商品、数量をメモリから消去します。ログアウト時も注文・商品マスター・セッションを消去します。

## セキュリティ構成

- Supabase Authでログインしたユーザーだけが商品取得を試行できます。
- `products` と `exhibition_accounts` はRLSを有効化しています。
- RLSは `exhibition_staff` の有効なスタッフ行と `auth.uid()` が一致する場合だけSELECTを許可します。
- `anon` には商品・帳合先のSELECT権限を付与しません。
- ブラウザへ渡すのはSupabase URLと公開可能なPublishable Keyだけです。
- `service_role`、Secret Key、パスワードはブラウザやGitHubへ置きません。
- Publishable Keyは利用者から見える前提です。非公開データの保護は認証とRLSで行います。

DB定義は [20260901090000_private_product_master.sql](supabase/migrations/20260901090000_private_product_master.sql) にあります。

## ローカル設定

`.env.example` を `.env` としてコピーし、次の値を設定します。

```dotenv
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_public_key
EXHIBITION_EVENT_NAME=展示会
```

`.env` と生成される `online-config.js` はGit管理外です。

```powershell
node scripts/generate-config.mjs
node scripts/build-site.mjs
python -m http.server 8765 --bind 127.0.0.1 --directory _site
```

ブラウザで `http://127.0.0.1:8765/` を開きます。本番と同様、登録スタッフのログインが必要です。

## GitHub Pages公開

`.github/workflows/deploy-pages.yml` は安全な許可リストから `_site` を組み立てて公開します。リポジトリのActions Variablesへ次を登録してください。

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `EXHIBITION_EVENT_NAME`

これらは公開ページから確認可能な値です。秘密情報をVariablesへ入れないでください。

## テスト

```powershell
node --test tests/*.test.mjs
node --check app.js
node --check workflow.js
node --check security.js
node scripts/build-site.mjs
```

架空データ用の `tests/browser-fixture-server.mjs` と `tests/render-print-fixture.mjs` で、実データを送信せずにログイン後のUIとA4印刷レイアウトを検証できます。結果は [TEST_REPORT.md](TEST_REPORT.md) に記録しています。

## 既存環境に関する注意

現在のコミットで非公開ファイルを追跡対象から外しても、過去のGit履歴には残ります。また、既存Supabaseには旧版が保存した注文行と旧注文APIがあります。実施済み内容と、承認後に行う履歴除去・旧API停止は [SECURITY_MIGRATION_REPORT.md](SECURITY_MIGRATION_REPORT.md) を確認してください。
