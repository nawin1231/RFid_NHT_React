import React from "react";
import { shallow } from "enzyme";
import MbrMonitor from "./MbrMonitor";

describe("MbrMonitor", () => {
  test("matches snapshot", () => {
    const wrapper = shallow(<MbrMonitor />);
    expect(wrapper).toMatchSnapshot();
  });
});
