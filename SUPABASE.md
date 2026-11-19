# Garder les comptes : base de données Supabase (gratuite)

Sur Render (offre gratuite), le disque est effacé à chaque redémarrage du serveur. Les comptes, le pass de combat,
la maîtrise et les skins sont donc rangés dans une base de données Supabase.

## 1. Créer la base (5 minutes)

1. Va sur https://supabase.com, clique sur **Start your project** et connecte-toi avec GitHub.
2. **New project** : nom `cs-arena`, choisis un mot de passe de base de données (garde-le), région **Europe (Paris ou Frankfurt)**, puis **Create new project**. Attends 1 à 2 minutes.
3. Menu de gauche : **SQL Editor** → **New query**, colle ce code puis clique sur **Run** :

```sql
create table if not exists cs_store (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz default now()
);
alter table cs_store enable row level security;
```

4. Récupère les deux informations pour le serveur :
   - **Project URL** : bouton **Connect** en haut de la page (ou **Project Settings → Data API**), une adresse du type `https://abcdefgh.supabase.co`.
   - **la clé secrète** : **Project Settings → API Keys**. Prends la clé **Secret** (`sb_secret_…`, bouton *Reveal* ou *Copy*), ou dans l'onglet **Legacy API Keys** la clé **service_role**. Les deux marchent. Ne prends pas la clé *publishable* / *anon*.
   Cette clé est secrète : ne la mets jamais dans le jeu ni sur GitHub.

## 2. Brancher le serveur Render

Sur https://dashboard.render.com → ton service **cs-arene** → **Environment** → **Add Environment Variable** :

| Key | Value |
|---|---|
| `SUPABASE_URL` | la Project URL |
| `SUPABASE_KEY` | la clé service_role |

Clique sur **Save Changes** : Render redémarre le serveur. Dans **Logs**, tu dois voir :
`Comptes : 0 (base de données Supabase)` puis `CS Arena en ligne sur le port …`

C'est tout : les comptes ne sont plus jamais effacés.

## Bon à savoir

- Sans ces deux variables, le serveur garde les comptes dans `data/accounts.json` (comme avant).
- Si la base ne répond pas au démarrage, le serveur n'écrit rien (il ne peut pas l'effacer) et réessaie toutes les 10 secondes.
- Un projet Supabase gratuit se met en pause après 7 jours sans aucune activité : un e-mail te prévient, il suffit de cliquer sur *Restore*. Tant que des gens jouent, il reste actif.
