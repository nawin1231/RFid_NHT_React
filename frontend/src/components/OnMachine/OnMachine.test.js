import React from "react";
import { shallow } from "enzyme";
import OnMachine from "./OnMachine";

describe("OnMachine", () => {
  test("matches snapshot", () => {
    const wrapper = shallow(<OnMachine />);
    expect(wrapper).toMatchSnapshot();
  });
});
