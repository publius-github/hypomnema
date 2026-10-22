// Unmounts what each test rendered. Testing Library only registers this
// itself when Vitest runs with `globals: true`, which this project does not.
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(cleanup);
