# 展示会スタッフ専用 注文管理

NEO TOKYO 2026 を想定したスマホ優先の注文管理ツールです。商品検索から注文登録、会計・商品準備・受け渡し管理、国内通常注文の注文書送信までを扱います。

## 完成版の主な機能

- 3,861商品の最新版マスターを品番・商品名で検索
- 国内通常注文、即時現売り、後日会場受取、ホテル配送、指定先配送
- 会計・商品準備・受け渡し／発送を別々に管理
- 国内通常注文は受注チャンネルへの送信成功時だけ「完了」扱い
- 通信失敗時は端末へ保存し、「未同期」「注文書未送信」を明示
- オンライン復旧時に未同期注文と未送信注文書を自動再送
- 注文詳細から注文書をPDF保存・印刷
- スタッフ認証済みの利用者だけが注文書送信APIを実行可能

## 商品マスター

2026年8月1日改定分を次のルールで統合しています。

- 基準: `無題のスプレッドシート (1).xlsx`（3,861商品）
- 改定: `改正価格表2026.8.1～（卸価格表）小売価格税抜・税込　株式会社サンニシムラ1.xlsx`（71商品）
- 商品コード完全一致で71件すべて照合し、基準の卸価格と改定表の「現卸」も全件一致
- 71件へ「新卸」を反映
- 改定表の商品はすべて基準マスター内に存在したため、今回の新規追加は0件
- コード `63463` は基準データに異なる2商品があるため、自動改番せず両方を選択可能
- `141-801` と `141-802` は卸価格が「未定」のため、検索はできるが注文への追加は不可

ツールは `product_master.csv` を読み込みます。列は `code,name,price,status` です。監査用Excelは `outputs/exhibition-order-production-20260810/商品マスター最新版_2026-08-01.xlsx` にあります。

## 起動

ES Modules とCSV読込を使うため、ファイルを直接開かずHTTPサーバーから起動します。

```powershell
python -m http.server 4173 --bind 127.0.0.1
```

ブラウザで `http://127.0.0.1:4173/` を開きます。本番設定は `online-config.js` の `onlineEnabled: true` です。既存の注文登録APIは本番GitHub PagesのOriginだけを許可しているため、ローカルではログイン画面の「端末モードで開始」を使い、実送信は公開URLで確認します。

## 注文書送信

国内通常注文で「注文書を送信」を押すと、次の順に処理します。

1. 注文を端末へ保存
2. 既存の `exhibition-order` Edge Function で注文を作成
3. `exhibition-slack` Edge Function から受注チャンネルへ注文書を送信
4. 送信成功応答を受け取った場合だけ `submitted=true` と送信日時を保存
5. 失敗時は要対応タブに残し、「注文書を再送」を表示

送信内容には店舗、電話、帳合先、受注担当、商品別数量・金額、合計、備考、操作スタッフを含みます。

## Supabase 配備

プロジェクト参照IDは `qdexhwgzawisiklekfzm` です。Supabaseへログイン済みの環境で次を実行します。

```powershell
supabase secrets set SLACK_WEBHOOK_URL=<Slack Incoming Webhook URL> --project-ref qdexhwgzawisiklekfzm
supabase functions deploy exhibition-slack --project-ref qdexhwgzawisiklekfzm --use-api
```

`supabase/config.toml` では `verify_jwt = true` を維持してください。Webhook URL、service role key、個人のアクセストークンをブラウザ側ファイルやGitへ保存してはいけません。

配備後は次を確認します。

- 既存スタッフアカウントでログインできる
- 国内通常注文の送信後に受注チャンネルへ1件届く
- 画面が「注文書送信済み」「完了」へ変わる
- 端末モードでは「送信待ち」となり、完了へ移動しない
- `exhibition-slack` の未認証呼び出しが401になる

## テスト

```powershell
node --test tests/*.test.mjs
node --check workflow.js
node --check app.js
```

ブラウザ確認はスマホ幅390×844で、改定価格検索、重複コードの個別追加、価格未定商品の追加禁止、通常注文の送信待ち・再送導線を対象にします。
