# 展示会注文管理

登録スタッフ専用の展示会注文UIです。公開GitHubには画面と処理だけを置き、商品名・卸価格・帳合先・保存済み注文はSupabaseからログイン後に取得します。

2026-09-03の依頼により、当初の「注文はメモリだけ・印刷後に消去」から「スタッフ間でクラウド共有・印刷後も保存」へ変更しました。

公開URL: https://masuda8105-prog.github.io/exhibition-order-production/

## データの保存場所

| 保存場所 | 保存するもの | 保存しないもの |
| --- | --- | --- |
| GitHub | HTML、CSS、JavaScript、一般公開ロゴ、テスト、Supabaseマイグレーション、公開設定のひな形 | 商品マスター、卸価格、価格改定Excel、非公開画像、顧客情報、注文履歴、生成済み接続設定 |
| Supabase | Auth、スタッフ権限、商品マスター、卸価格、帳合先、保存した注文と顧客情報 | 注文PDF |
| ブラウザメモリ | 入力途中の注文、表示中の商品・注文 | タブ終了後に残す下書き |
| `localStorage` | ログイン継続用セッション、スタッフ表示名、固定キーの左右設定 | パスワード、注文、会社名、顧客担当者名、電話番号、備考、商品、数量 |
| `sessionStorage` | 旧ログイン情報を移行後に消去 | 注文・顧客情報 |

「保存・同期が完了しました」と表示された注文は、タブ終了・再読み込み・PDF作成・印刷・ログアウト後もSupabaseに残ります。PDFを利用者が保存した場合は、その端末のダウンロード先にもPDFが残ります。

未保存の入力はメモリのみです。入力画面を閉じても同じタブ内では再開できますが、タブ終了や再読み込みでは失われるため、離脱前に警告を表示します。

## ログイン・注文同期

- 一度ログインすると、同じブラウザでは次回もログイン状態を復元し、有効期限に合わせてセッションを更新します。
- パスワード変更・管理者による失効・ブラウザデータ削除などの場合は再ログインが必要です。共有端末を使い終わったらログアウトしてください。
- 注文はSupabaseへの保存確認後にだけ完了表示します。通信エラー時は入力を残して再試行でき、応答が途切れた再試行でも重複登録を防ぎます。
- 注文一覧は表示中に約12秒ごと、画面復帰時、再接続時に同期します。「同期」ボタンでも更新できます。
- 同じ注文を別端末で変更した場合は上書きを止め、入力を保持して最新内容の確認を促します。
- 「一覧から非表示」は全端末へ反映しますが、復旧用データはSupabaseに保持します。アプリには物理削除権限がありません。
- 旧環境の対象展示会で非表示でなかった13件を引き継ぎました。旧テーブルの22件は変更していません。

画面は注文一覧・検索・新規注文・詳細／修正・印刷を中心に整理し、本社未共有・受取待ち・未会計の表示は削除しました。

## セキュリティ構成

- Supabase Authでログインしたユーザーだけが商品取得を試行できます。
- `products`、`exhibition_accounts`、`exhibition_app_orders` はRLSを有効化しています。
- RLSは `exhibition_staff` の有効なスタッフ行と `auth.uid()` が一致する場合だけSELECTを許可します。
- `anon` には商品・帳合先・注文のSELECT権限を付与しません。
- 注文は有効スタッフだけが閲覧・作成・変更でき、作成者・更新者・更新時刻はDB側で記録します。更新時刻の照合で同時編集による上書きを防ぎます。
- ブラウザへ渡すのはSupabase URLと公開可能なPublishable Keyだけです。
- `service_role`、Secret Key、パスワードはブラウザやGitHubへ置きません。
- Publishable Keyは利用者から見える前提です。非公開データの保護は認証とRLSで行います。

DB定義は [商品マスター](supabase/migrations/20260901090000_private_product_master.sql)、[注文同期](supabase/migrations/20260902070825_secure_app_order_sync.sql)、[旧注文の引き継ぎ](supabase/migrations/20260903000514_preserve_existing_exhibition_orders.sql) にあります。

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

架空データ用の `tests/browser-fixture-server.mjs`、`tests/sync-browser-check.mjs`、`tests/render-print-fixture.mjs` で、実データを送信せずにログイン・同期・UI・A4印刷レイアウトを検証できます。結果は [TEST_REPORT.md](TEST_REPORT.md) に記録しています。

## 既存環境に関する注意

現在のコミットで非公開ファイルを追跡対象から外しても、過去のGit履歴には残ります。また、既存Supabaseには旧版が保存した注文行と旧注文APIがあります。実施済み内容と、承認後に行う履歴除去・旧API停止は [SECURITY_MIGRATION_REPORT.md](SECURITY_MIGRATION_REPORT.md) を確認してください。
