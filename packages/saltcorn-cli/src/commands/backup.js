// File: backup.js
/**
 * @category saltcorn-cli
 * @module commands/backup
 */
const { Command, Flags } = require("@oclif/core");
const { execSync } = require("child_process");
const dateFormat = require("dateformat");
const os = require("os");
const { getConnectObject } = require("@saltcorn/data/db/connect");
const day = dateFormat(new Date(), "yyyymmdd");
const connobj = getConnectObject();
const { init_some_tenants } = require("../common");
const fs = require("fs");

const pgdb = connobj.database;

const default_filenm = `${day}-${pgdb}-${os.hostname}.sqlc`;

/**
 * BackupCommand Class
 * @extends oclif.Command
 * @category saltcorn-cli
 */
class BackupCommand extends Command {
  /**
   * @returns {Promise<void>}
   */
  async run() {
    const { flags } = await this.parse(BackupCommand);

    if (flags.tenant) {
      // for tenant do saltcorn backup
      const { create_backup } = require("@saltcorn/admin-models/models/backup");

      await init_some_tenants(flags.tenant);
      const db = require("@saltcorn/data/db");

      if (flags.verbose)
        console.log(
          `Start to prepare backup of tenant "${flags.tenant}" in saltcorn format`,
          flags.tenant
        );

      await db.runWithTenant(flags.tenant, async () => {
        const fnm = await create_backup(flags.output);
        console.log(fnm);
      });
    } else if (flags.all_tenants) {
      const db = require("@saltcorn/data/db");

      const { create_backup } = require("@saltcorn/admin-models/models/backup");
      const { loadAllPlugins } = require("@saltcorn/server/load_plugins");
      const { eachTenant } = require("@saltcorn/admin-models/models/tenant");
      const { init_multi_tenant } = require("@saltcorn/data/db/state");
      let nten = 0,
        nerr = 0;
      const domain_files = {};
      await eachTenant(async () => {
        try {
          nten += 1;
          const domain = db.getTenantSchema();
          await init_multi_tenant(loadAllPlugins, undefined, [domain]);
          console.log("Backup tenant", domain);
          const fnm = await create_backup(flags.output);
          console.log(fnm);
          domain_files[domain] = fnm;
        } catch (e) {
          nerr += 1;
          console.error(e);
        }
      });
      fs.writeFileSync("domain_files.json", JSON.stringify(domain_files));
      console.log("done backup all tenants", nerr, "/", nten, "errors");
    } else if (flags.zip) {
      // zip the saltcorn backup
      const { create_backup } = require("@saltcorn/admin-models/models/backup");
      const { loadAllPlugins } = require("@saltcorn/server/load_plugins");
      await loadAllPlugins();

      if (flags.verbose)
        console.log(
          `Start to prepare backup of public tenant in saltcorn format`
        );

      const fnm = await create_backup(flags.output);
      console.log(fnm);
    } else {
      // else do pg_dump backup
      const db = require("@saltcorn/data/db");
      if (db.isSQLite) {
        console.log(`Database Backup is supported only for PostgreSQL`);
        this.exit(1);
      }

      const pguser = connobj.user;
      const pghost = connobj.host || "localhost";
      const pgport = connobj.port || 5432;
      const outfnm = flags.output || default_filenm;
      const env = { ...process.env, PGPASSWORD: connobj.password };

      if (flags.verbose) {
        console.log("Do database backup using pg_dump");
        console.log(
          `pg_dump ${pgdb} -U ${pguser} -h ${pghost} -p ${pgport} -F c >${outfnm}`
        );
      }

      execSync(
        `pg_dump ${pgdb} -U ${pguser} -h ${pghost} -p ${pgport} -F c >${outfnm}`,
        {
          stdio: "inherit",
          env,
        }
      );
      console.log(outfnm);
    }
    this.exit(0);
  }
}

/**
 * @type {string}
 */
BackupCommand.description = `Backup the PostgreSQL database to a file with pg_dump or saltcorn backup zip`;

/**
 * @type {string}
 */
BackupCommand.help = `Backup the PostgreSQL database to a file with pg_dump or saltcorn backup zip`;

/**
 * @type {object}
 */
BackupCommand.flags = {
  verbose: Flags.boolean({ char: "v", description: "Verbose" }),
  output: Flags.string({
    char: "o",
    description: "output filename",
  }),
  tenant: Flags.string({
    char: "t",
    description: "Backup tenant in saltcorn zip format",
  }),
  all_tenants: Flags.boolean({
    char: "a",
    description: "Backup all tenants in saltcorn zip format",
  }),
  zip: Flags.boolean({
    char: "z",
    description: "Backup public in saltcorn zip format",
  }),
};

module.exports = BackupCommand;
