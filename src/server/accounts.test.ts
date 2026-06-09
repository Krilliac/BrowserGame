import { describe, expect, it } from 'vitest';
import { openDatabase } from './db/database.js';
import { AccessLevel, createAccount, setAccess, verifyLogin } from './accounts.js';

describe('accounts', () => {
  it('seeds a default developer account', () => {
    const db = openDatabase(':memory:');
    expect(verifyLogin(db, 'dev', 'changeme')).toBe(AccessLevel.Developer);
  });

  it('verifies correct credentials and rejects wrong ones', () => {
    const db = openDatabase(':memory:');
    createAccount(db, 'bob', 'hunter2', AccessLevel.GameMaster);
    expect(verifyLogin(db, 'bob', 'hunter2')).toBe(AccessLevel.GameMaster);
    expect(verifyLogin(db, 'bob', 'wrong')).toBeNull();
    expect(verifyLogin(db, 'nobody', 'hunter2')).toBeNull();
  });

  it('updates access level', () => {
    const db = openDatabase(':memory:');
    createAccount(db, 'mod', 'pw', AccessLevel.Moderator);
    expect(setAccess(db, 'mod', AccessLevel.Admin)).toBe(true);
    expect(verifyLogin(db, 'mod', 'pw')).toBe(AccessLevel.Admin);
    expect(setAccess(db, 'ghost', AccessLevel.Admin)).toBe(false);
  });
});
