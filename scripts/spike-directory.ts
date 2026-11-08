// 用真实凭据抓取一次通讯录，只输出计数与脱敏样例，便于核对接口字段。
import { ConfigService } from "../apps/server/src/config/config.service.js";
import { DatabaseService } from "../apps/server/src/db/database.service.js";
import { SettingsService } from "../apps/server/src/settings/settings.service.js";
import { FeishuClient } from "../apps/server/src/feishu/feishu.client.js";
import { DirectoryFetcher } from "../apps/server/src/feishu/directory.fetcher.js";

const config = new ConfigService();
const database = new DatabaseService(config);
const settings = new SettingsService(config, database);
const client = new FeishuClient(config, settings);
const fetcher = new DirectoryFetcher(client, config);

try {
  const credentials = settings.getFeishu();
  if (!credentials.configured) {
    console.error("尚未配置飞书 App ID / App Secret，请先在平台设置页填写。");
    process.exit(1);
  }
  const root = process.argv[2] || credentials.rootDepartmentId || "0";
  const result = await fetcher.fetch({ rootDepartmentId: root });
  const samplePeople = result.people.slice(0, 3).map((person) => ({
    openId: `${person.openId.slice(0, 8)}…`,
    name: `${person.name.slice(0, 1)}**`,
    hasEmail: Boolean(person.email || person.enterpriseEmail),
    hasTitle: Boolean(person.jobTitle),
    hasEmployeeNo: Boolean(person.employeeNo),
    departmentCount: person.departmentIds.length,
    status: person.status,
  }));
  console.log(
    JSON.stringify(
      {
        rootDepartmentId: root,
        departments: result.departments.length,
        people: result.people.length,
        warnings: result.warnings,
        sampleDepartments: result.departments.slice(0, 3).map((item) => ({
          id: `${item.openDepartmentId.slice(0, 8)}…`,
          parentId: `${item.parentOpenDepartmentId.slice(0, 8)}…`,
          name: `${item.name.slice(0, 2)}…`,
        })),
        samplePeople,
      },
      null,
      2,
    ),
  );
} finally {
  database.sqlite.close();
}
