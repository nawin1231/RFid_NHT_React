import React from "react";
import { shallow } from "enzyme";
import MachineValidate from "./MachineValidate";

describe("MachineValidate", () => {
  test("matches snapshot", () => {
    const wrapper = shallow(<MachineValidate />);
    expect(wrapper).toMatchSnapshot();
  });
});
