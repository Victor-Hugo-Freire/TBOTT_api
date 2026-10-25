import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

import { PGlite } from '@electric-sql/pglite';

import { applyMigrations, MIGRATIONS_DIR, runSeeds } from '../scripts/lib/sqlRunner.js';
import {
  createAuthUser,
  createTestDatabase,
  insertRun,
  runAsAnon,
  runAsRole,
  runAsUser,
  toQueryClient
} from './helpers/testDatabase.js';

// Códigos de erro do PostgreSQL usados nos testes.
const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';
const RESTRICT_VIOLATION = '23001';
const CHECK_VIOLATION = '23514';
const INSUFFICIENT_PRIVILEGE = '42501';

const hasCode = (code) => (error) => {
  assert.equal(error.code, code, `esperado erro ${code}, recebido ${error.code}: ${error.message}`);
  return true;
};

// Conta privilégios de schema_migrations concedidos a qualquer papel que não seja o dono
// (grantee = 0 significa PUBLIC, ou seja, todos os papéis).
const countNonOwnerPrivileges = async (database) => {
  const result = await database.query(`
    select count(*)::int as total
    from pg_class, aclexplode(coalesce(pg_class.relacl, acldefault('r', pg_class.relowner))) as acl
    where pg_class.oid = 'public.schema_migrations'::regclass
      and acl.grantee <> pg_class.relowner
  `, []);

  return result.rows[0].total;
};

let pglite;
let db;

before(async () => {
  ({ pglite, db } = await createTestDatabase());
});

after(async () => {
  await pglite.close();
});

describe('migrações e seed', () => {
  test('rodar as migrações de novo não aplica nada', async () => {
    const applied = await applyMigrations(db);
    assert.deepEqual(applied, []);
  });

  test('rodar o seed várias vezes não duplica personagens', async () => {
    await runSeeds(db);
    await runSeeds(db);

    const result = await db.query("select count(*)::int as total from public.characters where id = 'tung-tung-sahur'", []);
    assert.equal(result.rows[0].total, 1);
  });

  test('o seed cadastra apenas o personagem confirmado, sem sprite inventado', async () => {
    const result = await db.query('select id, name, description, sprite_path, display_order from public.characters', []);
    assert.deepEqual(result.rows, [{
      id: 'tung-tung-sahur',
      name: 'Tung Tung Sahur',
      description: 'Ataca inimigos próximos usando um bastão.',
      sprite_path: null,
      display_order: 1
    }]);
  });

  test('o seed restaura os dados oficiais sem apagar outros personagens', async () => {
    await db.query("update public.characters set name = 'Nome errado', display_order = 9 where id = 'tung-tung-sahur'", []);
    await db.query("insert into public.characters (id, name, display_order) values ('personagem-extra', 'Extra', 2)", []);

    await runSeeds(db);

    const result = await db.query('select id, name, display_order from public.characters order by display_order', []);
    assert.deepEqual(result.rows, [
      { id: 'tung-tung-sahur', name: 'Tung Tung Sahur', display_order: 1 },
      { id: 'personagem-extra', name: 'Extra', display_order: 2 }
    ]);

    await db.query("delete from public.characters where id = 'personagem-extra'", []);
  });
});

describe('profiles', () => {
  test('o cadastro no Auth cria o perfil com o nome de usuário informado', async () => {
    const userId = await createAuthUser(db, { email: 'perfil1@example.com', username: 'Perfil_Um' });

    const result = await db.query('select username from public.profiles where id = $1', [userId]);
    assert.equal(result.rows[0].username, 'Perfil_Um');
  });

  test('nome repetido com outra capitalização não bloqueia o cadastro e recebe nome provisório', async () => {
    await createAuthUser(db, { email: 'dono@example.com', username: 'NomeDisputado' });
    const secondId = await createAuthUser(db, { email: 'copia@example.com', username: 'nomedisputado' });

    const result = await db.query('select username from public.profiles where id = $1', [secondId]);
    assert.match(result.rows[0].username, /^jogador_[0-9a-f]{12}$/);
  });

  test('cadastro sem nome de usuário também recebe nome provisório', async () => {
    const userId = await createAuthUser(db, { email: 'semnome@example.com' });

    const result = await db.query('select username from public.profiles where id = $1', [userId]);
    assert.match(result.rows[0].username, /^jogador_[0-9a-f]{12}$/);
  });

  test('o banco rejeita nomes iguais ignorando maiúsculas e minúsculas', async () => {
    const userId = await createAuthUser(db, { email: 'unico@example.com', username: 'Unico_1' });

    await assert.rejects(
      db.query('update public.profiles set username = $1 where id = $2', ['PERFIL_UM', userId]),
      hasCode(UNIQUE_VIOLATION)
    );
  });

  test('o banco rejeita nome de usuário fora do formato', async () => {
    const userId = await createAuthUser(db, { email: 'formato@example.com', username: 'Formato_ok' });

    await assert.rejects(
      db.query('update public.profiles set username = $1 where id = $2', ['a b', userId]),
      hasCode(CHECK_VIOLATION)
    );
  });

  test('não existe perfil sem conta correspondente em auth.users', async () => {
    await assert.rejects(
      db.query("insert into public.profiles (id, username) values (gen_random_uuid(), 'fantasma')", []),
      hasCode(FOREIGN_KEY_VIOLATION)
    );
  });

  test('apagar a conta no Auth apaga o perfil e as runs em cascata', async () => {
    const userId = await createAuthUser(db, { email: 'apagar@example.com', username: 'Apagar_me' });
    await insertRun(db, { userId, status: 'victory', durationMs: 1000, finishedAt: '2026-10-01T10:00:00Z' });

    await db.query('delete from auth.users where id = $1', [userId]);

    const profiles = await db.query('select 1 from public.profiles where id = $1', [userId]);
    const runs = await db.query('select 1 from public.game_runs where user_id = $1', [userId]);
    assert.equal(profiles.rowCount, 0);
    assert.equal(runs.rowCount, 0);
  });
});

describe('game_runs', () => {
  let userId;

  before(async () => {
    userId = await createAuthUser(db, { email: 'runs@example.com', username: 'Runs_Teste' });
  });

  test('não aceita personagem inexistente', async () => {
    await assert.rejects(
      insertRun(db, { userId, characterId: 'nao-existe', status: 'in_progress' }),
      hasCode(FOREIGN_KEY_VIOLATION)
    );
  });

  test('não aceita status desconhecido', async () => {
    await assert.rejects(
      insertRun(db, { userId, status: 'pausada' }),
      hasCode(CHECK_VIOLATION)
    );
  });

  test('run encerrada precisa de duração e data de término', async () => {
    await assert.rejects(
      insertRun(db, { userId, status: 'victory', durationMs: null, finishedAt: '2026-10-01T10:00:00Z' }),
      hasCode(CHECK_VIOLATION)
    );
  });

  test('não aceita duração zero ou negativa', async () => {
    await assert.rejects(
      insertRun(db, { userId, status: 'victory', durationMs: 0, finishedAt: '2026-10-01T10:00:00Z' }),
      hasCode(CHECK_VIOLATION)
    );
  });

  test('não permite apagar um personagem usado em runs', async () => {
    await insertRun(db, { userId, status: 'defeat', durationMs: 5000, finishedAt: '2026-10-01T10:00:00Z' });

    await assert.rejects(
      db.query("delete from public.characters where id = 'tung-tung-sahur'", []),
      hasCode(RESTRICT_VIOLATION)
    );
  });
});

describe('segurança (RLS e privilégios pela Data API)', () => {
  let playerA;
  let playerB;

  before(async () => {
    playerA = await createAuthUser(db, { email: 'rls.a@example.com', username: 'Rls_A' });
    playerB = await createAuthUser(db, { email: 'rls.b@example.com', username: 'Rls_B' });
    await insertRun(db, { userId: playerA, status: 'victory', durationMs: 1000, finishedAt: '2026-10-01T10:00:00Z' });
    await insertRun(db, { userId: playerB, status: 'victory', durationMs: 2000, finishedAt: '2026-10-01T10:00:00Z' });
  });

  test('visitante sem login lê o catálogo de personagens', async () => {
    const rows = await runAsAnon(db, async () => (await db.query('select id from public.characters', [])).rows);
    assert.equal(rows.length, 1);
  });

  test('visitante sem login não lê perfis nem runs', async () => {
    await runAsAnon(db, async () => {
      await assert.rejects(db.query('select * from public.profiles', []), hasCode(INSUFFICIENT_PRIVILEGE));
      await assert.rejects(db.query('select * from public.game_runs', []), hasCode(INSUFFICIENT_PRIVILEGE));
    });
  });

  test('jogador só enxerga o próprio perfil e as próprias runs', async () => {
    await runAsUser(db, playerA, async () => {
      const profiles = await db.query('select id from public.profiles', []);
      const runs = await db.query('select user_id from public.game_runs', []);

      assert.deepEqual(profiles.rows.map((row) => row.id), [playerA]);
      assert.ok(runs.rows.length > 0);
      assert.ok(runs.rows.every((row) => row.user_id === playerA));
    });
  });

  test('jogador altera o próprio nome, mas não o de outro jogador', async () => {
    await runAsUser(db, playerA, async () => {
      const own = await db.query('update public.profiles set username = $1 where id = $2', ['Rls_A_novo', playerA]);
      const other = await db.query('update public.profiles set username = $1 where id = $2', ['Invadido', playerB]);

      assert.equal(own.affectedRows, 1);
      assert.equal(other.affectedRows, 0);
    });

    const result = await db.query('select username from public.profiles where id = $1', [playerB]);
    assert.equal(result.rows[0].username, 'Rls_B');
  });

  test('jogador não altera outras colunas do perfil (ex.: created_at)', async () => {
    await runAsUser(db, playerA, async () => {
      await assert.rejects(
        db.query("update public.profiles set created_at = '2000-01-01' where id = $1", [playerA]),
        hasCode(INSUFFICIENT_PRIVILEGE)
      );
    });
  });

  test('jogador não registra nem altera runs diretamente (só pela API)', async () => {
    await runAsUser(db, playerA, async () => {
      await assert.rejects(
        db.query(
          "insert into public.game_runs (user_id, character_id) values ($1, 'tung-tung-sahur')",
          [playerA]
        ),
        hasCode(INSUFFICIENT_PRIVILEGE)
      );
      await assert.rejects(
        db.query('update public.game_runs set duration_ms = 1 where user_id = $1', [playerB]),
        hasCode(INSUFFICIENT_PRIVILEGE)
      );
    });
  });

  test('jogador não modifica o catálogo de personagens', async () => {
    await runAsUser(db, playerA, async () => {
      await assert.rejects(
        db.query("insert into public.characters (id, name, display_order) values ('hack', 'Hack', 9)", []),
        hasCode(INSUFFICIENT_PRIVILEGE)
      );
      await assert.rejects(
        db.query("update public.characters set name = 'Hack' where id = 'tung-tung-sahur'", []),
        hasCode(INSUFFICIENT_PRIVILEGE)
      );
    });
  });

});

describe('proteção de schema_migrations', () => {
  test('anon, authenticated e service_role não leem nem gravam o histórico', async () => {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      await runAsRole(db, role, async () => {
        await assert.rejects(db.query('select * from public.schema_migrations', []), hasCode(INSUFFICIENT_PRIVILEGE));
        await assert.rejects(
          db.query("insert into public.schema_migrations (version) values ('9999_invasao')", []),
          hasCode(INSUFFICIENT_PRIVILEGE)
        );
      });
    }
  });

  test('em um banco novo, só o dono da tabela tem privilégios (inclusive sem PUBLIC)', async () => {
    assert.equal(await countNonOwnerPrivileges(db), 0);
  });

  test('o RLS da tabela continua ativado', async () => {
    const result = await db.query(
      "select relrowsecurity from pg_class where oid = 'public.schema_migrations'::regclass",
      []
    );
    assert.equal(result.rows[0].relrowsecurity, true);
  });

  test('o executor continua lendo e registrando migrações como dono sem ser superusuário', async () => {
    // Simula o "postgres" do Supabase: dono da tabela, mas não superusuário.
    await db.query('create role migration_owner nologin', []);
    await db.query('grant usage, create on schema public to migration_owner', []);
    await db.query('alter table public.schema_migrations owner to migration_owner', []);

    const directory = await mkdtemp(path.join(os.tmpdir(), 'tbott-migracoes-'));
    await writeFile(path.join(directory, '9999_teste_executor.sql'), 'select 1;');

    try {
      await runAsRole(db, 'migration_owner', async () => {
        assert.deepEqual(await applyMigrations(db, directory), ['9999_teste_executor']);
        assert.deepEqual(await applyMigrations(db, directory), []);
      });
    } finally {
      await db.query("delete from public.schema_migrations where version = '9999_teste_executor'", []);
      await db.query('alter table public.schema_migrations owner to current_user', []);
    }
  });
});

describe('proteção de schema_migrations em um banco já existente', () => {
  let oldPglite;
  let oldDb;

  before(async () => {
    oldPglite = new PGlite();
    await oldPglite.exec(await readFile(new URL('./helpers/supabaseStub.sql', import.meta.url), 'utf8'));
    oldDb = toQueryClient(oldPglite);

    // Banco "antigo": só as migrações 0001 a 0003 aplicadas...
    const directory = await mkdtemp(path.join(os.tmpdir(), 'tbott-antigo-'));
    for (const fileName of ['0001_create_profiles.sql', '0002_create_characters.sql', '0003_create_game_runs.sql']) {
      await copyFile(path.join(MIGRATIONS_DIR, fileName), path.join(directory, fileName));
    }
    await applyMigrations(oldDb, directory);

    // ...e com os privilégios automáticos do Supabase ainda presentes na tabela de controle.
    await oldDb.query('grant all on public.schema_migrations to anon, authenticated, service_role, public', []);
  });

  after(async () => {
    await oldPglite.close();
  });

  test('aplica só a 0004, preserva o histórico e remove os privilégios', async () => {
    const historyBefore = await oldDb.query('select version, applied_at from public.schema_migrations order by version', []);
    assert.ok(await countNonOwnerPrivileges(oldDb) > 0);

    const applied = await applyMigrations(oldDb);

    const historyAfter = await oldDb.query('select version, applied_at from public.schema_migrations order by version', []);
    assert.deepEqual(applied, ['0004_protect_schema_migrations']);
    assert.deepEqual(historyAfter.rows.slice(0, 3), historyBefore.rows);
    assert.equal(historyAfter.rows.length, 4);
    assert.equal(await countNonOwnerPrivileges(oldDb), 0);
  });

  test('a migração 0004 pode ser executada de novo sem erro', async () => {
    const sql = await readFile(path.join(MIGRATIONS_DIR, '0004_protect_schema_migrations.sql'), 'utf8');
    await oldDb.query(sql);
    assert.equal(await countNonOwnerPrivileges(oldDb), 0);
  });
});
